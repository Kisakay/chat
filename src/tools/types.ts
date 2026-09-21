/** Platform tool: a server-side capability the frontend invokes explicitly
 *  (uploads always go through tools — never raw to the model). */
export interface PlatformTool {
  readonly name: string;
  readonly description: string;
  isAvailable(): boolean;
  unavailableReason(): string | null;
}
