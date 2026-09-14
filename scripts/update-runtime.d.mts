export type UpdatePlan = { before: string; target: string; branch: string };
export type UpdateCommand = (
  exe: string,
  args: string[],
  cwd: string,
  output?: (text: string) => void,
) => Promise<string>;
export function command(
  exe: string,
  args: string[],
  cwd: string,
  output?: (text: string) => void,
  signal?: AbortSignal,
): Promise<string>;
export function prepareUpdate(root: string, run?: UpdateCommand): Promise<UpdatePlan>;
export function applyUpdate(root: string, plan: UpdatePlan, run?: UpdateCommand): Promise<void>;
export function maintenancePage(): string;
