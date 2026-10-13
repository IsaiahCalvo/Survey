import { useEffect, useState } from 'react';
import { isPhoneLayout, subscribePhoneLayout } from '../utils/layoutMode.js';

/**
 * Phone layout or desktop layout, live (utils/layoutMode.js decides: the
 * screen's short side under 600 CSS px is a phone; touch never decides).
 */
export default function usePhoneLayout() {
  const [phone, setPhone] = useState(() => isPhoneLayout());
  useEffect(() => {
    setPhone(isPhoneLayout());
    return subscribePhoneLayout(setPhone);
  }, []);
  return phone;
}
