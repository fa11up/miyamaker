/* The page's entry (a file, not an inline script: the frame's CSP allows scripts from this site only). The shell is
   chosen before app.js loads, because app.js's imports capture #gl/#stage when they load (shell.js). */
import { selectShell } from './shell.js';
import { showBootError } from './ui/bootError.js';

try {
  selectShell();
  import('./app.js').then(({ mountModkeys }) => mountModkeys()).catch(showBootError);
} catch (e) {
  showBootError(e);
}
