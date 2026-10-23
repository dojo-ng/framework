---
"@dojo-ng/pubsub": patch
---

Fix a handler that publishes from inside a handler. The delivery loop used to compare against the state from before the outer publish, so a publish made by a handler made the outer topic look changed again, and it was delivered to its handlers a second time, without end if they published every time. Each publish is now delivered once.
