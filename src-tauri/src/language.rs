#[derive(serde::Deserialize)]
pub enum Language {
    #[serde(rename = "system")]
    System,
    #[serde(rename = "zh-CN")]
    Chinese,
    #[serde(rename = "en")]
    English,
}

impl Language {
    fn resolve(&self, lang_id: u16) -> &'static str {
        match self {
            Self::Chinese => "zh-CN",
            Self::English => "en",
            Self::System if lang_id & 0x03ff == 0x04 => "zh-CN",
            Self::System => "en",
        }
    }
    pub fn locale(&self) -> &'static str {
        #[cfg(windows)]
        let lang_id = unsafe { windows_sys::Win32::Globalization::GetUserDefaultUILanguage() };
        #[cfg(not(windows))]
        let lang_id = 0;
        self.resolve(lang_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn system_uses_ui_language_not_region() {
        for id in [0x0804, 0x0404, 0x0c04, 0x1004, 0x1404] {
            assert_eq!(Language::System.resolve(id), "zh-CN");
            assert_eq!(Language::English.resolve(id), "en");
        }
        for id in [0, 0x0409, 0x0809, 0x0411, 0x040c] {
            assert_eq!(Language::System.resolve(id), "en");
            assert_eq!(Language::Chinese.resolve(id), "zh-CN");
        }
    }
    #[test]
    fn preference_accepts_only_supported_values() {
        for value in ["system", "zh-CN", "en"] {
            assert!(serde_json::from_value::<Language>(serde_json::json!(value)).is_ok());
        }
        for value in [
            serde_json::json!("fr"),
            serde_json::json!(null),
            serde_json::json!(1),
        ] {
            assert!(serde_json::from_value::<Language>(value).is_err());
        }
    }
}
