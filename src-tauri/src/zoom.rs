//! Per-service zoom: the discrete steps, and the keyboard chord that walks
//! them. Kept dependency-light and pure so it is testable without a webview.

/// 50%..300%, the same spread browsers use for page zoom.
pub const STEPS: &[f64] = &[
    0.5, 0.67, 0.75, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0,
];

pub const DEFAULT: f64 = 1.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ZoomAction {
    In,
    Out,
    Reset,
}

/// `key` is a DOM `KeyboardEvent.key`. Ctrl/Cmd+`+`/`=` zooms in, Ctrl/Cmd+`-`
/// zooms out, and Ctrl/Cmd+`0` resets. Shift is accepted on the in/out chords
/// because typing `+` needs it on most keyboard layouts.
pub fn parse_zoom_shortcut(key: &str, ctrl_or_meta: bool, alt: bool) -> Option<ZoomAction> {
    if !ctrl_or_meta || alt {
        return None;
    }
    match key {
        "+" | "=" => Some(ZoomAction::In),
        "-" | "_" => Some(ZoomAction::Out),
        "0" => Some(ZoomAction::Reset),
        _ => None,
    }
}

/// Snap an arbitrary value onto the nearest step, so a hand-edited config or
/// a future step table can never leave a zoom the UI has no mark for.
pub fn clamp(value: f64) -> f64 {
    if !value.is_finite() {
        return DEFAULT;
    }
    STEPS
        .iter()
        .copied()
        .min_by(|left, right| {
            (left - value)
                .abs()
                .partial_cmp(&(right - value).abs())
                .unwrap_or(std::cmp::Ordering::Equal)
        })
        .unwrap_or(DEFAULT)
}

/// Apply one zoom action to a current level. `current` is snapped onto a step
/// first, so a value sitting between two steps still moves to a real one.
pub fn apply(action: ZoomAction, current: f64) -> f64 {
    match action {
        ZoomAction::Reset => DEFAULT,
        ZoomAction::In => {
            let current = clamp(current);
            STEPS
                .iter()
                .copied()
                .find(|step| *step > current + f64::EPSILON)
                .unwrap_or_else(|| *STEPS.last().unwrap())
        }
        ZoomAction::Out => {
            let current = clamp(current);
            STEPS
                .iter()
                .copied()
                .rev()
                .find(|step| *step < current - f64::EPSILON)
                .unwrap_or(STEPS[0])
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plus_and_equals_zoom_in_minus_zooms_out_zero_resets() {
        assert_eq!(parse_zoom_shortcut("+", true, false), Some(ZoomAction::In));
        assert_eq!(parse_zoom_shortcut("=", true, false), Some(ZoomAction::In));
        assert_eq!(parse_zoom_shortcut("-", true, false), Some(ZoomAction::Out));
        assert_eq!(parse_zoom_shortcut("_", true, false), Some(ZoomAction::Out));
        assert_eq!(
            parse_zoom_shortcut("0", true, false),
            Some(ZoomAction::Reset)
        );
        assert_eq!(parse_zoom_shortcut("1", true, false), None);
        assert_eq!(parse_zoom_shortcut("+", false, false), None);
        assert_eq!(parse_zoom_shortcut("+", true, true), None);
    }

    #[test]
    fn zoom_in_and_out_walk_the_step_table() {
        for pair in STEPS.windows(2) {
            assert_eq!(apply(ZoomAction::In, pair[0]), pair[1]);
            assert_eq!(apply(ZoomAction::Out, pair[1]), pair[0]);
        }
        assert_eq!(apply(ZoomAction::In, 1.0), 1.1);
        assert_eq!(apply(ZoomAction::Out, 1.0), 0.9);
        assert_eq!(apply(ZoomAction::In, 3.0), 3.0, "already at the top step");
        assert_eq!(
            apply(ZoomAction::Out, 0.5),
            0.5,
            "already at the bottom step"
        );
        assert_eq!(apply(ZoomAction::Reset, 2.5), 1.0);
    }

    #[test]
    fn a_value_between_two_steps_snaps_before_moving() {
        assert_eq!(apply(ZoomAction::In, 0.92), 1.0);
        assert_eq!(apply(ZoomAction::Out, 0.92), 0.8);
    }

    #[test]
    fn clamp_snaps_onto_the_nearest_known_step() {
        assert_eq!(clamp(1.0), 1.0);
        assert_eq!(clamp(0.52), 0.5);
        assert_eq!(clamp(10.0), 3.0);
        assert_eq!(clamp(0.0), 0.5);
        assert_eq!(clamp(f64::NAN), DEFAULT);
        assert_eq!(clamp(f64::INFINITY), DEFAULT);
    }
}
