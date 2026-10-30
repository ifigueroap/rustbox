use serde::{Deserialize, Serialize};

use crate::config::LanguagePreference;

/// Active UI language. `es` covers every Spanish locale tag.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Locale {
    En,
    Es,
}

static UI_LOCALE: std::sync::Mutex<Locale> = std::sync::Mutex::new(Locale::En);

pub fn ui_locale() -> Locale {
    *UI_LOCALE.lock().unwrap_or_else(|err| err.into_inner())
}

pub fn set_ui_locale(locale: Locale) {
    *UI_LOCALE.lock().unwrap_or_else(|err| err.into_inner()) = locale;
}

/// `es` and `es-*` map to Spanish. Every other tag maps to English.
pub fn locale_from_tag(tag: &str) -> Locale {
    let primary = tag
        .trim()
        .split(['-', '_'])
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    if primary == "es" {
        Locale::Es
    } else {
        Locale::En
    }
}

pub fn system_locale() -> Locale {
    locale_from_tag(&sys_locale::get_locale().unwrap_or_default())
}

pub fn resolve_preference(preference: LanguagePreference) -> Locale {
    match preference {
        LanguagePreference::En => Locale::En,
        LanguagePreference::Es => Locale::Es,
        LanguagePreference::System => system_locale(),
    }
}

pub fn tray_show(locale: Locale) -> &'static str {
    match locale {
        Locale::En => "Show window",
        Locale::Es => "Mostrar ventana",
    }
}

pub fn tray_hide(locale: Locale) -> &'static str {
    match locale {
        Locale::En => "Hide window",
        Locale::Es => "Ocultar ventana",
    }
}

pub fn tray_dnd(locale: Locale) -> &'static str {
    match locale {
        Locale::En => "Do not disturb",
        Locale::Es => "No molestar",
    }
}

pub fn tray_close(locale: Locale) -> &'static str {
    match locale {
        Locale::En => "Close window to tray",
        Locale::Es => "Cerrar la ventana a la bandeja",
    }
}

pub fn tray_quit(locale: Locale) -> &'static str {
    match locale {
        Locale::En => "Quit",
        Locale::Es => "Salir",
    }
}

pub fn tray_workspaces(locale: Locale) -> &'static str {
    match locale {
        Locale::En => "Workspaces",
        Locale::Es => "Espacios de trabajo",
    }
}

pub fn tray_workspace_dnd(locale: Locale, name: &str) -> String {
    match locale {
        Locale::En => format!("{name} — Do not disturb"),
        Locale::Es => format!("{name} — No molestar"),
    }
}

pub fn tray_check_updates(locale: Locale) -> &'static str {
    match locale {
        Locale::En => "Check for updates",
        Locale::Es => "Buscar actualizaciones",
    }
}

pub fn tray_update_available(locale: Locale) -> &'static str {
    match locale {
        Locale::En => "Update available",
        Locale::Es => "Actualización disponible",
    }
}

pub fn tray_update_available_version(locale: Locale, version: &str) -> String {
    match locale {
        Locale::En => format!("Update available: v{version}"),
        Locale::Es => format!("Actualización disponible: v{version}"),
    }
}

pub fn tooltip(locale: Locale, unread: u32) -> String {
    match (locale, unread) {
        (_, 0) => "Rustbox".to_string(),
        (Locale::En, 1) => "Rustbox — 1 unread".to_string(),
        (Locale::En, count) => format!("Rustbox — {count} unread"),
        (Locale::Es, 1) => "Rustbox — 1 sin leer".to_string(),
        (Locale::Es, count) => format!("Rustbox — {count} sin leer"),
    }
}

pub fn update_notification_title(locale: Locale) -> &'static str {
    match locale {
        Locale::En => "Rustbox update",
        Locale::Es => "Actualización de Rustbox",
    }
}

pub fn update_notification_body(locale: Locale, version: &str) -> String {
    match locale {
        Locale::En => format!("Version {version} is available."),
        Locale::Es => format!("La versión {version} está disponible."),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spanish_tags_map_to_es_and_everything_else_to_en() {
        assert_eq!(locale_from_tag("es"), Locale::Es);
        assert_eq!(locale_from_tag("es-CL"), Locale::Es);
        assert_eq!(locale_from_tag("ES_MX"), Locale::Es);
        assert_eq!(locale_from_tag("en-US"), Locale::En);
        assert_eq!(locale_from_tag("fr-FR"), Locale::En);
        assert_eq!(locale_from_tag(""), Locale::En);
    }

    #[test]
    fn tray_copy_follows_the_active_locale() {
        assert_eq!(tray_show(Locale::En), "Show window");
        assert_eq!(tray_show(Locale::Es), "Mostrar ventana");
        assert_eq!(tray_hide(Locale::Es), "Ocultar ventana");
        assert_eq!(tray_quit(Locale::Es), "Salir");
        assert_eq!(tray_dnd(Locale::Es), "No molestar");
        assert_eq!(tray_check_updates(Locale::Es), "Buscar actualizaciones");
        assert_eq!(
            tray_workspace_dnd(Locale::Es, "Trabajo"),
            "Trabajo — No molestar"
        );
        assert_eq!(tooltip(Locale::En, 0), "Rustbox");
        assert_eq!(tooltip(Locale::En, 1), "Rustbox — 1 unread");
        assert_eq!(tooltip(Locale::En, 4), "Rustbox — 4 unread");
        assert_eq!(tooltip(Locale::Es, 4), "Rustbox — 4 sin leer");
        assert_eq!(
            update_notification_body(Locale::Es, "0.8.0"),
            "La versión 0.8.0 está disponible."
        );
    }

    #[test]
    fn a_saved_language_overrides_the_system_locale() {
        assert_eq!(resolve_preference(LanguagePreference::En), Locale::En);
        assert_eq!(resolve_preference(LanguagePreference::Es), Locale::Es);
    }
}
