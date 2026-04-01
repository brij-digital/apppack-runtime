# Note For Loris

Hi Loris, here is a draft of our runtime agent spec. I’d love your feedback.

Our current belief is that Solana can become much more composable for agents not through thousands of MCP-style wrappers, but through declarative protocol files that let agents interact with Solana directly, without depending on external API calls for the core path.

The idea is to make the protocol pack self-descriptive:
- Codama remains the source of truth for instruction/account structure
- the runtime spec adds deterministic `views`, `writes`, and reusable `transforms`
- agents can prepare and submit transactions directly from these artifacts

At least for the first step, we think this could cover a large part of agent-native transaction execution in a much cleaner way than API-specific integrations.

Draft spec:
- https://app.brijmail.com/docs/runtime-spec/

Would love your honest take, especially on whether this feels like a reasonable abstraction layer on top of Codama, or if you think we are introducing the wrong kind of runtime surface.
