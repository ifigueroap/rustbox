//! Built-in services. Custom entries are just services without a preset id.

#[derive(Debug, Clone, Copy)]
pub struct Preset {
    pub id: &'static str,
    pub name: &'static str,
    pub url: Option<&'static str>,
    pub url_placeholder: &'static str,
    pub color: &'static str,
    pub monogram: &'static str,
    /// Registrable domains, other than the home URL's, that still belong to this service.
    pub extra_hosts: &'static [&'static str],
}

const PRESETS: &[Preset] = &[
    Preset {
        id: "whatsapp",
        name: "WhatsApp",
        url: Some("https://web.whatsapp.com/"),
        url_placeholder: "https://web.whatsapp.com/",
        color: "#128c7e",
        monogram: "WA",
        extra_hosts: &["whatsapp.com", "whatsapp.net"],
    },
    Preset {
        id: "slack",
        name: "Slack",
        url: Some("https://app.slack.com/"),
        url_placeholder: "https://app.slack.com/",
        color: "#4a154b",
        monogram: "Sl",
        extra_hosts: &["slack.com", "slack-edge.com", "slack-files.com"],
    },
    Preset {
        id: "discord",
        name: "Discord",
        url: Some("https://discord.com/app"),
        url_placeholder: "https://discord.com/app",
        color: "#5865f2",
        monogram: "Ds",
        extra_hosts: &[
            "discord.com",
            "discordapp.com",
            "discordapp.net",
            "discord.gg",
        ],
    },
    Preset {
        id: "zulip",
        name: "Zulip",
        url: None,
        url_placeholder: "https://your-org.zulipchat.com",
        color: "#2f6f4e",
        monogram: "Zu",
        extra_hosts: &["zulipchat.com", "zulip.com"],
    },
    Preset {
        id: "telegram",
        name: "Telegram",
        url: Some("https://web.telegram.org/a/"),
        url_placeholder: "https://web.telegram.org/a/",
        color: "#1d7aad",
        monogram: "Tg",
        extra_hosts: &["telegram.org", "t.me", "telegram.me"],
    },
    Preset {
        id: "grok",
        name: "Grok",
        url: Some("https://grok.com/"),
        url_placeholder: "https://grok.com/",
        color: "#2b2b2b",
        monogram: "Gk",
        extra_hosts: &["grok.com", "x.ai", "x.com", "twitter.com"],
    },
    Preset {
        id: "chatgpt",
        name: "ChatGPT",
        url: Some("https://chatgpt.com/"),
        url_placeholder: "https://chatgpt.com/",
        color: "#0e8c6d",
        monogram: "Gp",
        extra_hosts: &["chatgpt.com", "openai.com", "oaistatic.com"],
    },
    Preset {
        id: "claude",
        name: "Claude",
        url: Some("https://claude.ai/"),
        url_placeholder: "https://claude.ai/",
        color: "#c4643e",
        monogram: "Cl",
        extra_hosts: &["claude.ai", "anthropic.com", "claude.com"],
    },
];

pub fn all() -> &'static [Preset] {
    PRESETS
}

pub fn find(id: &str) -> Option<&'static Preset> {
    all().iter().find(|preset| preset.id == id)
}

pub fn extra_hosts(preset_id: Option<&str>) -> Vec<String> {
    find(preset_id.unwrap_or(""))
        .map(|preset| {
            preset
                .extra_hosts
                .iter()
                .map(|host| (*host).to_string())
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use url::Url;

    #[test]
    fn presets_are_unique_and_urls_parse() {
        let mut ids = Vec::new();
        for preset in all() {
            assert!(preset.monogram.chars().count() <= 3, "{}", preset.id);
            assert!(!ids.contains(&preset.id), "duplicate {}", preset.id);
            ids.push(preset.id);
            if let Some(url) = preset.url {
                let parsed =
                    Url::parse(url).unwrap_or_else(|_| panic!("bad url for {}", preset.id));
                assert!(parsed.host_str().is_some());
            } else {
                assert_eq!(preset.id, "zulip");
            }
        }
        assert!(ids.contains(&"whatsapp"));
        assert!(ids.contains(&"slack"));
        assert!(ids.contains(&"discord"));
        assert!(ids.contains(&"zulip"));
        assert!(ids.contains(&"telegram"));
        assert!(ids.contains(&"grok"));
        assert!(ids.contains(&"chatgpt"));
        assert!(ids.contains(&"claude"));
    }
}
