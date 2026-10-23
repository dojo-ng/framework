---
"@dojo-ng/history": minor
---

Add hash mode (`mode: "hash"`), scroll restoration (`scroll`), focus after a navigation (`focus`), and navigation guards (`block`). Hash mode keeps the route after `#` so a static server can serve every deep link. Scroll restoration returns the window and named scrolling elements to where the user left them on Back, Forward and reload. Focus moves to the new view's heading after a `go`. `block` asks before a `go` or a Back or Forward, and undoes a refused Back with `history.go`, never a write.
