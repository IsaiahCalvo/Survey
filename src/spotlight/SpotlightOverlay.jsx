// What the spotlight shows over the viewer (Nightly flag 'spotlight'),
// copied from Drawboard Projects:
//   presenter — a 1px green frame round the canvas and a green tab in its top
//               right corner: "N following" and Stop;
//   follower  — "Name is presenting" with Follow; while following, the same
//               frame and "Following Name" with Stop; after a pan of their own,
//               "Follow again".
// The frame never takes a press (pointer-events: none); only the tab and the
// chip do.
import { follow, followAgain, stopFollowing, stopPresenting } from '../services/annotationSpotlight.js';
import { cursorLabel } from '../services/annotationLiveCursors.js';
import useSpotlight from './useSpotlight.js';
import './spotlight.css';

export default function SpotlightOverlay({ phone = false }) {
  const spotlight = useSpotlight();
  const { presenting, followerCount, presenter, following, paused } = spotlight;
  const name = cursorLabel(presenter?.name);
  const cls = (base) => `${base}${phone ? ' is-phone' : ''}`;

  if (presenting) {
    return (
      <div className={cls('spotlight-frame')} data-spotlight-frame="presenting">
        <div className="spotlight-tab" role="status" data-spotlight-tab>
          <span data-spotlight-count={followerCount}>{followerCount} following</span>
          <button type="button" className="spotlight-tab__stop" data-spotlight-stop onClick={stopPresenting}>Stop</button>
        </div>
      </div>
    );
  }
  if (following && !paused && presenter) {
    return (
      <div className={cls('spotlight-frame')} data-spotlight-frame="following">
        <div className="spotlight-tab" role="status" data-spotlight-tab>
          <span>Following {name}</span>
          <button type="button" className="spotlight-tab__stop" data-spotlight-unfollow onClick={stopFollowing}>Stop</button>
        </div>
      </div>
    );
  }
  if (presenter && presenter.documentId === spotlight.documentId) {
    const again = following && paused;
    return (
      <div className={cls('spotlight-chip')} role="status" data-spotlight-chip={again ? 'paused' : 'presenting'}>
        <span className="spotlight-chip__dot" aria-hidden="true" />
        <span className="spotlight-chip__text">{name} is presenting</span>
        {again ? (
          <>
            <button type="button" className="spotlight-chip__btn is-primary" data-spotlight-follow-again onClick={followAgain}>Follow again</button>
            <button type="button" className="spotlight-chip__btn" data-spotlight-unfollow onClick={stopFollowing}>Stop</button>
          </>
        ) : (
          <button type="button" className="spotlight-chip__btn is-primary" data-spotlight-follow onClick={() => follow(presenter.userId)}>Follow</button>
        )}
      </div>
    );
  }
  return null;
}
