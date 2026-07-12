# AzaLoop Auto-continue Rules (MANDATORY — Execute on session start)

1. Call aza_context status to get current state
2. If .aza/RESUME.md exists: call aza_loop next with current_story
3. If no RESUME.md: ask user → call aza_prd generate
4. Always follow next_action chain from MCP responses
5. On cross-session: call aza_memory query for relevant history
