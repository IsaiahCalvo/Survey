// An error whose message is written for the person using the tool, so the UI
// shows it as is. Anything else gets a generic "something went wrong".
export class ToolError extends Error {}
