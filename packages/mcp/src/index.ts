/**
 * @veloce/mcp: lets AI agents build decks through the Model Context Protocol.
 *
 * `VeloceMcp` serves the tools/resources/instructions over Streamable HTTP; tools act on the
 * doc-server's workspace through the same transactions the editor uses.
 */
export { docTopics, getDocs, INSTRUCTIONS } from "./docs.js";
export * from "./input.js";
export { agentOrigin, VeloceMcp, type VeloceMcpOptions } from "./server.js";
export { deckSummary, formatLint, slideOutline } from "./summary.js";
export {
  callTool,
  TOOLS,
  type ToolContext,
  type ToolDefinition,
  type ToolResult,
  toolInputSchema,
} from "./tools.js";
