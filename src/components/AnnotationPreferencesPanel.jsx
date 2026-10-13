/**
 * AnnotationPreferencesPanel.jsx — Settings → Annotations (KAL-397, F19).
 *
 * Acrobat keeps annotation behavior under Preferences → Annotations; Survey's
 * Settings dialog is its preferences, so the tab sits there. First setting:
 * "Fit text boxes to their text" (src/utils/textboxAutoFitPreference.js holds
 * the rule and where it is stored). The hint under the switch says what the
 * CURRENT choice does, so nobody has to guess which way On points.
 */
import { useEffect, useState } from 'react';
import {
  readTextboxAutoFit,
  writeTextboxAutoFit,
  TEXTBOX_AUTO_FIT_CHANGE_EVENT,
} from '../utils/textboxAutoFitPreference';

export const AUTO_FIT_HINT_ON = 'A text box grows or shrinks to fit its text each time you finish typing. Once you resize a box yourself, it keeps your size.';
export const AUTO_FIT_HINT_OFF = 'A text box keeps the size you give it. A box you drag out stays the size you drew. Text can make a box taller, never smaller.';

export default function AnnotationPreferencesPanel() {
  const [autoFit, setAutoFit] = useState(() => readTextboxAutoFit());

  // Another window or tab of the app may change it.
  useEffect(() => {
    const sync = () => setAutoFit(readTextboxAutoFit());
    window.addEventListener(TEXTBOX_AUTO_FIT_CHANGE_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(TEXTBOX_AUTO_FIT_CHANGE_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const toggle = () => setAutoFit(writeTextboxAutoFit(!autoFit));

  return (
    <section className="account-section annotation-prefs">
      <h3>Annotations</h3>
      <p className="account-section-description">
        These choices are saved on this device.
      </p>
      <div className="annotation-prefs-row">
        <div className="annotation-prefs-text">
          <div className="annotation-prefs-label" id="pref-textbox-auto-fit-label">
            Fit text boxes to their text
          </div>
          <div className="account-field-hint" id="pref-textbox-auto-fit-hint">
            {autoFit ? AUTO_FIT_HINT_ON : AUTO_FIT_HINT_OFF}
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={autoFit}
          aria-labelledby="pref-textbox-auto-fit-label"
          aria-describedby="pref-textbox-auto-fit-hint"
          data-pref="textbox-auto-fit"
          className={`annotation-prefs-switch${autoFit ? ' is-on' : ''}`}
          onClick={toggle}
        >
          <span className="annotation-prefs-switch-knob" aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
