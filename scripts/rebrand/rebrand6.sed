# Pass 6: update tests — CDN host moved to the project's own release mirror.
s|https://static\.aionui\.com/releases|https://github.com/searcht-ui/SearchT/releases/download|g
s|static\.aionui\.com|github.com|g
s|iOfficeAI/SearchT|searcht-ui/SearchT|g
