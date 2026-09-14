import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { prepareUpdate, type UpdatePlan } from '../scripts/update-runtime.mjs';
import type { UpdateState } from '../shared/types.js';

export const applicationRoot = fileURLToPath(new URL('../', import.meta.url));

export class AppUpdater {
  state: UpdateState;
  constructor(
    private launch?: (plan: UpdatePlan, id: string) => void,
    private prepare = () => prepareUpdate(applicationRoot),
    initial?: UpdateState,
  ) {
    this.state = initial ?? {
      status: 'idle',
      message: launch
        ? 'Download the latest version from GitHub, install dependencies, build and restart.'
        : 'Start the application with npm start to enable automatic updates.',
    };
  }
  get available() {
    return !!this.launch;
  }
  get busy() {
    return ['checking', 'installing', 'restarting'].includes(this.state.status);
  }
  start() {
    if (!this.launch)
      throw new Error('Start the application with npm start to enable automatic updates.');
    if (this.busy) throw new Error('An application update is already in progress.');
    const id = randomUUID();
    this.state = { id, status: 'checking', message: 'Checking the latest version on GitHub…' };
    void this.prepare()
      .then((plan) => {
        if (plan.before === plan.target) {
          this.state = {
            id,
            status: 'current',
            message: 'The application is already up to date.',
            revision: plan.target,
          };
          return;
        }
        this.state = {
          id,
          status: 'installing',
          message: 'Preparing to install the update and restart…',
        };
        this.launch!(plan, id);
      })
      .catch((error) => {
        this.state = {
          id,
          status: 'error',
          message: error instanceof Error ? error.message : String(error),
        };
      });
    return id;
  }
}
