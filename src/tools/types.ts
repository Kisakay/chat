/** Platform tool: a server-side capability the frontend invokes explicitly
 *  (uploads always go through tools — never raw to the model). Availability
 *  is async: feature flags live in the database now. */
export interface PlatformTool {
  readonly name: string;
  readonly description: string;
  isAvailable(): Promise<boolean>;
  unavailableReason(): Promise<string | null>;
}
