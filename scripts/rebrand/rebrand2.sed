# SearchT rebrand pass 2: URLs, leftover AionUi brands, internal artifacts.
s|github\.com/iOfficeAI/AionUi|github.com/searcht-ui/SearchT|g
s|https://www\.aionui\.com|https://github.com/searcht-ui/SearchT|g
s|https://aionui\.com|https://github.com/searcht-ui/SearchT|g
s|http://aionui\.com|https://github.com/searcht-ui/SearchT|g
/AionCore\|'AionUi'\|"AionUi"/!s/AionUi/SearchT/g
/AionCore\|'AIONUI'\|"AIONUI"/!s/AIONUI/SEARCHT/g
/__aionui/!s/aionui-web/searcht-web/g
/__aionui/!s/aionui_/searcht_/g
s/__aionui/__searcht/g
s/aionui-web-/searcht-web-/g
