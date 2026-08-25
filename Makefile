
cat-config:
	@base64 -D -i ~/.searcht-config-dev/searcht-config.txt | python3 -c 'import sys, urllib.parse; print(urllib.parse.unquote(sys.stdin.read()))' | pbcopy
