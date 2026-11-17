/* KAL-658: a side panel that needs an account, shown on a file opened with
 * none (services/deviceFiles.js). The same quiet centred line as any empty
 * side panel (tests/sidePanelEmptyState.test.mjs), with one way forward. */
import './AccountNeededNote.css';
import { askSignIn } from '../utils/proLock.js';

export default function AccountNeededNote({ children, name }) {
  return (
    <div className="account-needed-note" data-needs-account={name}>
      <div>{children}</div>
      <button type="button" className="account-needed-note__btn" onClick={() => askSignIn()}>Sign in</button>
    </div>
  );
}
