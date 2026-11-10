//! Scheduled Do not disturb: pure evaluation logic with no Tauri or GTK
//! dependency, so it can be unit tested in isolation.
//!
//! Time of day is tracked as minutes since local midnight, and the week is
//! tracked as minutes since local Monday 00:00 (`week_minutes`). Both are
//! plain integer arithmetic on a circular clock: no calendar date is
//! involved, so the math is intentionally DST-insensitive. The only place a
//! real calendar date matters is [`local_now`], which reads the OS clock and
//! timezone through `chrono` to produce a [`Now`] for the current instant;
//! everything else in this module takes a `Moment`/`Now` value as input.

use chrono::{Datelike, Timelike};
use serde::{Deserialize, Serialize};

/// Day of the week a rule applies to. Spelled out (not `chrono::Weekday`) so
/// the on-disk representation is independent of the `chrono` crate.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Day {
    Mon,
    Tue,
    Wed,
    Thu,
    Fri,
    Sat,
    Sun,
}

pub const ALL_DAYS: [Day; 7] = [
    Day::Mon,
    Day::Tue,
    Day::Wed,
    Day::Thu,
    Day::Fri,
    Day::Sat,
    Day::Sun,
];

impl Day {
    pub fn index(self) -> u32 {
        match self {
            Day::Mon => 0,
            Day::Tue => 1,
            Day::Wed => 2,
            Day::Thu => 3,
            Day::Fri => 4,
            Day::Sat => 5,
            Day::Sun => 6,
        }
    }

    fn from_chrono(weekday: chrono::Weekday) -> Self {
        match weekday {
            chrono::Weekday::Mon => Day::Mon,
            chrono::Weekday::Tue => Day::Tue,
            chrono::Weekday::Wed => Day::Wed,
            chrono::Weekday::Thu => Day::Thu,
            chrono::Weekday::Fri => Day::Fri,
            chrono::Weekday::Sat => Day::Sat,
            chrono::Weekday::Sun => Day::Sun,
        }
    }
}

pub const DAY_MINUTES: u32 = 24 * 60;
pub const WEEK_MINUTES: u32 = DAY_MINUTES * 7;

/// A point in the local week: a weekday plus minutes since that day's
/// midnight (`0..DAY_MINUTES`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Moment {
    pub day: Day,
    pub minute: u16,
}

impl Moment {
    pub fn new(day: Day, minute: u16) -> Self {
        Self { day, minute }
    }

    pub fn week_minutes(self) -> u32 {
        self.day.index() * DAY_MINUTES + self.minute as u32
    }

    fn from_week_minutes(week_minutes: u32) -> Self {
        let week_minutes = week_minutes % WEEK_MINUTES;
        let day = ALL_DAYS[(week_minutes / DAY_MINUTES) as usize];
        let minute = (week_minutes % DAY_MINUTES) as u16;
        Moment { day, minute }
    }
}

/// The current instant: a [`Moment`] for schedule evaluation, plus the real
/// Unix timestamp (seconds) for comparing against an override's expiry.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Now {
    pub moment: Moment,
    pub unix: i64,
}

impl Now {
    pub fn new(moment: Moment, unix: i64) -> Self {
        Self { moment, unix }
    }
}

/// Reads the OS clock and local timezone. Not unit tested directly (there is
/// no fixed expectation for "right now"); every pure function below takes its
/// `Now`/`Moment` as a parameter instead of calling this itself.
pub fn local_now() -> Now {
    let now = chrono::Local::now();
    let moment = Moment::new(
        Day::from_chrono(now.weekday()),
        (now.hour() * 60 + now.minute()) as u16,
    );
    Now::new(moment, now.timestamp())
}

/// One rule: active during `start_minute..end_minute` local time on each of
/// `days`. `end_minute <= start_minute` crosses midnight: the part after
/// midnight belongs to the next day while the rule is still "that day's"
/// rule, e.g. Fri 19:00-08:00 is active Friday 19:00 through Saturday 08:00.
/// `start_minute == end_minute` is treated as an empty (never active) window;
/// the editor rejects it so this only happens on a hand-edited config.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleRule {
    pub days: Vec<Day>,
    pub start_minute: u16,
    pub end_minute: u16,
}

/// A list of rules plus an on/off switch, kept separate so toggling off does
/// not lose the configured rules.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Schedule {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub rules: Vec<ScheduleRule>,
}

/// A manual choice that wins over the schedule until `expires_at_unix`, at
/// which point the schedule governs again. Created when the user toggles Do
/// not disturb while a schedule is enabled; persisted so a restart inside the
/// override's window still honors it.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DndOverride {
    pub value: bool,
    pub expires_at_unix: i64,
}

pub const MAX_RULES: usize = 20;

/// The rule's duration in minutes, or `None` when it covers no time at all
/// (equal start/end, or an out-of-range minute from a hand-edited config).
fn rule_length(rule: &ScheduleRule) -> Option<u32> {
    if rule.start_minute as u32 >= DAY_MINUTES || rule.end_minute as u32 >= DAY_MINUTES {
        return None;
    }
    if rule.start_minute == rule.end_minute {
        return None;
    }
    Some(if rule.end_minute > rule.start_minute {
        (rule.end_minute - rule.start_minute) as u32
    } else {
        DAY_MINUTES - rule.start_minute as u32 + rule.end_minute as u32
    })
}

/// Whether `point` (a week-minute) falls in the circular span
/// `[start, start + length)`, wrapping at `WEEK_MINUTES` so a window that
/// crosses Sunday into Monday is handled the same as any other midnight
/// crossing.
fn duration_contains(point: u32, start: u32, length: u32) -> bool {
    if length == 0 {
        return false;
    }
    let offset = (point + WEEK_MINUTES - start % WEEK_MINUTES) % WEEK_MINUTES;
    offset < length
}

fn rule_covers(rule: &ScheduleRule, point: u32) -> bool {
    let Some(length) = rule_length(rule) else {
        return false;
    };
    rule.days.iter().any(|day| {
        let start = day.index() * DAY_MINUTES + rule.start_minute as u32;
        duration_contains(point, start, length)
    })
}

/// Whether the schedule says Do not disturb should be on at `moment`.
/// `enabled` is checked here, so a disabled schedule is never active even if
/// its rules would otherwise match.
pub fn is_active(schedule: &Schedule, moment: Moment) -> bool {
    schedule.enabled
        && schedule
            .rules
            .iter()
            .any(|rule| rule_covers(rule, moment.week_minutes()))
}

/// The start and end week-minute of one rule's occurrence on each of its
/// days, i.e. every point at which that rule's coverage flips on or off.
fn rule_boundaries(rule: &ScheduleRule) -> Vec<u32> {
    let Some(length) = rule_length(rule) else {
        return Vec::new();
    };
    rule.days
        .iter()
        .flat_map(|day| {
            let start = (day.index() * DAY_MINUTES + rule.start_minute as u32) % WEEK_MINUTES;
            let end = (start + length) % WEEK_MINUTES;
            [start, end]
        })
        .collect()
}

/// The next moment, strictly after `moment`, at which some rule's coverage
/// starts or ends — regardless of whether that flips the *overall* schedule
/// state (two overlapping rules can share a boundary that changes nothing).
/// `None` only when the schedule has no rule that defines any boundary (e.g.
/// every rule has no days, or an equal start/end).
pub fn next_boundary(schedule: &Schedule, moment: Moment) -> Option<Moment> {
    if !schedule.enabled {
        return None;
    }
    let now = moment.week_minutes();
    let mut best: Option<u32> = None;
    for rule in &schedule.rules {
        for point in rule_boundaries(rule) {
            let delta = (point + WEEK_MINUTES - now) % WEEK_MINUTES;
            if delta == 0 {
                continue;
            }
            let better = match best {
                None => true,
                Some(current) => delta < (current + WEEK_MINUTES - now) % WEEK_MINUTES,
            };
            if better {
                best = Some(point);
            }
        }
    }
    best.map(Moment::from_week_minutes)
}

/// Whether `override_` is still in effect at `now` (set and not yet expired).
pub fn override_active(override_: Option<&DndOverride>, now: Now) -> bool {
    override_.is_some_and(|value| now.unix < value.expires_at_unix)
}

/// Combine the manual toggle, any live override, and the schedule into the
/// effective Do not disturb state.
///
/// When the schedule is off or empty, this is exactly `manual`: the original,
/// schedule-free behavior. Otherwise an unexpired override wins; failing
/// that, the schedule's own `is_active` governs.
pub fn effective_dnd(
    manual: bool,
    override_: Option<&DndOverride>,
    schedule: &Schedule,
    now: Now,
) -> bool {
    if !schedule.enabled || schedule.rules.is_empty() {
        return manual;
    }
    if override_active(override_, now) {
        return override_.expect("override_active implies Some").value;
    }
    is_active(schedule, now.moment)
}

/// Build the override a manual toggle creates while a schedule is active: it
/// holds `desired` until the next boundary, at which point the schedule
/// resumes governing. `None` when the schedule has no boundary to expire at
/// (callers should fall back to the schedule-free manual toggle in that
/// case).
pub fn make_override(schedule: &Schedule, now: Now, desired: bool) -> Option<DndOverride> {
    let target = next_boundary(schedule, now.moment)?;
    let now_minutes = now.moment.week_minutes() as i64;
    let mut delta = target.week_minutes() as i64 - now_minutes;
    if delta <= 0 {
        delta += WEEK_MINUTES as i64;
    }
    Some(DndOverride {
        value: desired,
        expires_at_unix: now.unix - now.unix.rem_euclid(60) + delta * 60,
    })
}

/// Normalize and validate a schedule coming from the editor: dedupe each
/// rule's days, and reject anything that cannot be evaluated unambiguously.
pub fn validate(input: Schedule) -> Result<Schedule, String> {
    if input.rules.len() > MAX_RULES {
        return Err(format!("a schedule can have at most {MAX_RULES} rules"));
    }
    let mut rules = Vec::with_capacity(input.rules.len());
    for mut rule in input.rules {
        rule.days.sort_by_key(|day| day.index());
        rule.days.dedup();
        if rule.days.is_empty() {
            return Err("pick at least one day for each rule".into());
        }
        if rule.start_minute as u32 >= DAY_MINUTES || rule.end_minute as u32 >= DAY_MINUTES {
            return Err("time must be between 00:00 and 23:59".into());
        }
        if rule.start_minute == rule.end_minute {
            return Err("a rule's start and end time must be different".into());
        }
        rules.push(rule);
    }
    Ok(Schedule {
        enabled: input.enabled,
        rules,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn moment(day: Day, minute: u16) -> Moment {
        Moment::new(day, minute)
    }

    fn rule(days: &[Day], start_minute: u16, end_minute: u16) -> ScheduleRule {
        ScheduleRule {
            days: days.to_vec(),
            start_minute,
            end_minute,
        }
    }

    fn schedule(rules: Vec<ScheduleRule>) -> Schedule {
        Schedule {
            enabled: true,
            rules,
        }
    }

    #[test]
    fn overrides_expire_at_the_minute_not_seconds_after_it() {
        let sched = schedule(vec![rule(&[Day::Mon], 540, 1020)]);
        let now = Now::new(moment(Day::Mon, 600), 36037);
        assert_eq!(make_override(&sched, now, false).unwrap().expires_at_unix, 61200);
    }

    #[test]
    fn overlapping_rule_boundaries_still_end_an_override() {
        let sched = schedule(vec![rule(&[Day::Mon], 540, 1020), rule(&[Day::Mon], 660, 720)]);
        let now = Now::new(moment(Day::Mon, 600), 36000);
        assert_eq!(next_boundary(&sched, now.moment), Some(moment(Day::Mon, 660)));
        let off = make_override(&sched, now, false).unwrap();
        let boundary = Now::new(moment(Day::Mon, 660), off.expires_at_unix);
        assert!(effective_dnd(false, Some(&off), &sched, boundary));
    }

    #[test]
    fn disabled_schedule_is_never_active() {
        let mut sched = schedule(vec![rule(&[Day::Mon], 0, 23 * 60)]);
        sched.enabled = false;
        assert!(!is_active(&sched, moment(Day::Mon, 30)));
        assert_eq!(next_boundary(&sched, moment(Day::Mon, 30)), None);
    }

    #[test]
    fn same_day_window_is_active_only_inside_its_range() {
        let sched = schedule(vec![rule(&[Day::Mon], 9 * 60, 17 * 60)]);
        assert!(!is_active(&sched, moment(Day::Mon, 8 * 60 + 59)));
        assert!(is_active(&sched, moment(Day::Mon, 9 * 60)));
        assert!(is_active(&sched, moment(Day::Mon, 12 * 60)));
        assert!(!is_active(&sched, moment(Day::Mon, 17 * 60)));
    }

    #[test]
    fn midnight_crossing_window_covers_the_next_day_too() {
        // Mon-Fri 19:00-08:00: Friday night through Saturday morning counts.
        let days = [Day::Mon, Day::Tue, Day::Wed, Day::Thu, Day::Fri];
        let sched = schedule(vec![rule(&days, 19 * 60, 8 * 60)]);
        assert!(is_active(&sched, moment(Day::Fri, 19 * 60)));
        assert!(is_active(&sched, moment(Day::Fri, 23 * 60 + 59)));
        assert!(is_active(&sched, moment(Day::Sat, 0)));
        assert!(is_active(&sched, moment(Day::Sat, 7 * 60 + 59)));
        assert!(!is_active(&sched, moment(Day::Sat, 8 * 60)));
        assert!(!is_active(&sched, moment(Day::Sat, 12 * 60)));
        // The daytime hours on a listed day are not covered.
        assert!(!is_active(&sched, moment(Day::Mon, 12 * 60)));
    }

    #[test]
    fn week_wraps_from_sunday_into_monday() {
        let sched = schedule(vec![rule(&[Day::Sun], 22 * 60, 6 * 60)]);
        assert!(is_active(&sched, moment(Day::Sun, 23 * 60)));
        assert!(is_active(&sched, moment(Day::Mon, 0)));
        assert!(is_active(&sched, moment(Day::Mon, 5 * 60 + 59)));
        assert!(!is_active(&sched, moment(Day::Mon, 6 * 60)));
        assert!(!is_active(&sched, moment(Day::Mon, 12 * 60)));
    }

    #[test]
    fn equal_start_and_end_is_never_active() {
        let sched = schedule(vec![rule(&[Day::Mon], 9 * 60, 9 * 60)]);
        assert!(!is_active(&sched, moment(Day::Mon, 9 * 60)));
        assert!(!is_active(&sched, moment(Day::Mon, 0)));
    }

    #[test]
    fn multiple_and_overlapping_rules_combine_with_or() {
        let sched = schedule(vec![
            rule(&[Day::Mon], 9 * 60, 12 * 60),
            rule(&[Day::Mon], 11 * 60, 14 * 60),
            rule(&[Day::Wed], 0, 60),
        ]);
        assert!(is_active(&sched, moment(Day::Mon, 10 * 60))); // first rule only
        assert!(is_active(&sched, moment(Day::Mon, 13 * 60))); // second rule only
        assert!(!is_active(&sched, moment(Day::Mon, 8 * 60)));
        assert!(!is_active(&sched, moment(Day::Mon, 14 * 60)));
        assert!(is_active(&sched, moment(Day::Wed, 30)));
        assert!(!is_active(&sched, moment(Day::Tue, 30)));
    }

    #[test]
    fn next_boundary_finds_the_nearest_start_or_end_across_rules() {
        let sched = schedule(vec![
            rule(&[Day::Mon], 9 * 60, 17 * 60),
            rule(&[Day::Wed], 8 * 60, 10 * 60),
        ]);
        // Inside Monday's window: next boundary is that window's end.
        assert_eq!(
            next_boundary(&sched, moment(Day::Mon, 10 * 60)),
            Some(moment(Day::Mon, 17 * 60))
        );
        // Before Monday's window: next boundary is its start.
        assert_eq!(
            next_boundary(&sched, moment(Day::Mon, 0)),
            Some(moment(Day::Mon, 9 * 60))
        );
        // Between the two windows: nearest is Wednesday's start.
        assert_eq!(
            next_boundary(&sched, moment(Day::Mon, 18 * 60)),
            Some(moment(Day::Wed, 8 * 60))
        );
    }

    #[test]
    fn next_boundary_wraps_the_week_back_to_monday() {
        let sched = schedule(vec![rule(&[Day::Mon], 9 * 60, 17 * 60)]);
        // Late Friday: the only boundary left is next Monday's start.
        assert_eq!(
            next_boundary(&sched, moment(Day::Fri, 20 * 60)),
            Some(moment(Day::Mon, 9 * 60))
        );
    }

    #[test]
    fn next_boundary_is_none_without_any_usable_rule() {
        let sched = schedule(vec![rule(&[], 9 * 60, 17 * 60)]);
        assert_eq!(next_boundary(&sched, moment(Day::Mon, 0)), None);
        let sched = schedule(vec![rule(&[Day::Mon], 9 * 60, 9 * 60)]);
        assert_eq!(next_boundary(&sched, moment(Day::Mon, 0)), None);
        let sched = schedule(Vec::new());
        assert_eq!(next_boundary(&sched, moment(Day::Mon, 0)), None);
    }

    #[test]
    fn effective_dnd_is_exactly_manual_without_a_schedule() {
        let empty = Schedule::default();
        let now = Now::new(moment(Day::Mon, 10 * 60), 1_700_000_000);
        assert!(!effective_dnd(false, None, &empty, now));
        assert!(effective_dnd(true, None, &empty, now));

        let mut disabled = schedule(vec![rule(&[Day::Mon], 0, 23 * 60 + 59)]);
        disabled.enabled = false;
        assert!(!effective_dnd(false, None, &disabled, now));
        assert!(effective_dnd(true, None, &disabled, now));
    }

    #[test]
    fn effective_dnd_follows_the_schedule_without_an_override() {
        let sched = schedule(vec![rule(&[Day::Mon], 9 * 60, 17 * 60)]);
        let inside = Now::new(moment(Day::Mon, 10 * 60), 1_700_000_000);
        let outside = Now::new(moment(Day::Mon, 20 * 60), 1_700_000_000);
        assert!(effective_dnd(false, None, &sched, inside));
        assert!(!effective_dnd(true, None, &sched, outside));
    }

    #[test]
    fn effective_dnd_lets_an_unexpired_override_win() {
        let sched = schedule(vec![rule(&[Day::Mon], 9 * 60, 17 * 60)]);
        let now = Now::new(moment(Day::Mon, 10 * 60), 1_700_000_000);
        // Inside the window, the schedule alone says on; the user turned it off.
        let off = DndOverride {
            value: false,
            expires_at_unix: 1_700_000_100,
        };
        assert!(!effective_dnd(false, Some(&off), &sched, now));

        // Outside the window, the schedule alone says off; the user turned it on.
        let outside = Now::new(moment(Day::Mon, 20 * 60), 1_700_000_000);
        let on = DndOverride {
            value: true,
            expires_at_unix: 1_700_000_100,
        };
        assert!(effective_dnd(false, Some(&on), &sched, outside));
    }

    #[test]
    fn override_expires_exactly_at_its_boundary_instant() {
        let sched = schedule(vec![rule(&[Day::Mon], 9 * 60, 17 * 60)]);
        let moment_now = moment(Day::Mon, 10 * 60);
        let off = DndOverride {
            value: false,
            expires_at_unix: 1_700_000_100,
        };
        let just_before = Now::new(moment_now, 1_700_000_099);
        let at_expiry = Now::new(moment_now, 1_700_000_100);
        assert!(!effective_dnd(false, Some(&off), &sched, just_before));
        // At (and after) the expiry instant the override no longer applies,
        // so the schedule's own state (active, inside the window) governs.
        assert!(effective_dnd(false, Some(&off), &sched, at_expiry));
    }

    #[test]
    fn make_override_targets_the_next_boundary_instant() {
        let sched = schedule(vec![rule(&[Day::Mon], 9 * 60, 17 * 60)]);
        let now = Now::new(moment(Day::Mon, 10 * 60), 1_700_000_000);
        let override_ = make_override(&sched, now, false).unwrap();
        assert!(!override_.value);
        // 17:00 - 10:00 = 7 hours later.
        assert_eq!(
            override_.expires_at_unix,
            now.unix - now.unix.rem_euclid(60) + 7 * 60 * 60
        );
    }

    #[test]
    fn make_override_is_none_when_the_schedule_has_no_boundary() {
        let sched = schedule(Vec::new());
        let now = Now::new(moment(Day::Mon, 10 * 60), 1_700_000_000);
        assert_eq!(make_override(&sched, now, true), None);
    }

    #[test]
    fn override_active_checks_both_presence_and_expiry() {
        let now = Now::new(moment(Day::Mon, 10 * 60), 1_700_000_000);
        assert!(!override_active(None, now));
        let live = DndOverride {
            value: true,
            expires_at_unix: 1_700_000_001,
        };
        assert!(override_active(Some(&live), now));
        let expired = DndOverride {
            value: true,
            expires_at_unix: 1_700_000_000,
        };
        assert!(!override_active(Some(&expired), now));
    }

    #[test]
    fn validate_rejects_impossible_rules() {
        assert!(validate(schedule(vec![rule(&[], 0, 60)])).is_err());
        assert!(validate(schedule(vec![rule(&[Day::Mon], 60, 60)])).is_err());
        assert!(validate(schedule(vec![rule(&[Day::Mon], 0, DAY_MINUTES as u16)])).is_err());
        let many = (0..MAX_RULES + 1)
            .map(|_| rule(&[Day::Mon], 0, 60))
            .collect();
        assert!(validate(schedule(many)).is_err());
    }

    #[test]
    fn validate_dedupes_days_and_keeps_valid_rules() {
        let input = schedule(vec![rule(&[Day::Mon, Day::Mon, Day::Tue], 60, 120)]);
        let validated = validate(input).unwrap();
        assert_eq!(validated.rules[0].days, vec![Day::Mon, Day::Tue]);
    }

    #[test]
    fn minute_arithmetic_never_touches_a_calendar_date() {
        // The whole evaluation surface (is_active/next_boundary/effective_dnd)
        // only ever takes a Moment/Now built from plain integers here, with no
        // chrono::DateTime involved, so there is nothing for a DST transition
        // to perturb.
        let sched = schedule(vec![rule(&[Day::Sun], 23 * 60, 1 * 60)]);
        assert!(is_active(&sched, moment(Day::Mon, 0)));
        assert!(is_active(&sched, moment(Day::Mon, 59)));
        assert!(!is_active(&sched, moment(Day::Mon, 60)));
    }
}
