import { useState } from 'react';
import { STORE } from '../monetization/entitlements';
import { CLOUD_CONFIG } from '../cloud/account';
import { ANALYTICS_ENABLED } from '../analytics';
import { BackButton } from './common';

/** Plain-language terms, refund policy and privacy notice, reflecting what this build actually does. */
export function LegalScreen({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<'privacy' | 'refunds' | 'terms'>('privacy');
  const contact = STORE ? STORE.supportEmail : null;
  return (
    <div className="screen legal">
      <header className="screen-top">
        <BackButton onClick={onBack} />
        <h2 className="screen-heading">Policies</h2>
        <span />
      </header>
      <div className="screen-scroll narrow legal-body">
        <div className="tabs" role="tablist">
          {(['privacy', 'refunds', 'terms'] as const).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} className={`tab${tab === t ? ' tab-on' : ''}`} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </div>
        {tab === 'privacy' && (
          <section>
            <h3>Privacy</h3>
            <p>You can play without an account. Your progress and settings are stored in your own browser on your device.</p>
            <ul>
              <li>
                <strong>Analytics:</strong>{' '}
                {ANALYTICS_ENABLED
                  ? 'We count anonymous events (for example "a game started" or "the Chaos+ page was opened") with Umami, which uses no cookies, collects no personal data and respects Do Not Track.'
                  : 'None. This version sends no analytics.'}
              </li>
              <li>
                <strong>Accounts:</strong>{' '}
                {CLOUD_CONFIG
                  ? 'If you create an account, your email address and game progress are stored with Supabase so you can play on other devices. You can ask us to delete them at any time.'
                  : 'Not available in this version; nothing leaves your device.'}
              </li>
              <li>
                <strong>Multiplayer:</strong> rooms connect players directly (peer to peer). The free PeerJS service introduces the browsers to each other, and players in the same room can see
                each other&rsquo;s network address. Names you choose are shown to the other players in your room.
              </li>
              <li>
                <strong>Purchases:</strong> payments are handled entirely by Gumroad; we never see your card details. To unlock Chaos+, your license key is checked with Gumroad by our
                server. We do not store it on our server.
              </li>
              <li>
                <strong>Advertising:</strong> there are no ads and no ad tracking.
              </li>
            </ul>
          </section>
        )}
        {tab === 'refunds' && (
          <section>
            <h3>Refunds</h3>
            <p>Chaos+ is a one-time digital purchase sold through Gumroad, which acts as the merchant of record and issues refunds.</p>
            <p>
              If Chaos+ does not work for you, or you bought it by mistake, ask for a refund within 14 days of purchase and you will get the full amount back. After a refund, Chaos+
              stops working on all devices.
            </p>
            <p>{contact ? <>Email {contact} with the email address you used on Gumroad.</> : 'Contact details will be published when purchases open.'}</p>
          </section>
        )}
        {tab === 'terms' && (
          <section>
            <h3>Terms</h3>
            <ul>
              <li>Chaos Theory is free to play. Chaos+ is optional and gives only cosmetic items and a supporter badge; it never affects gameplay, scores or multiplayer fairness.</li>
              <li>A Chaos+ license is for your own use, on up to 5 of your devices or browsers.</li>
              <li>Be respectful in multiplayer: no offensive names. Rooms are private and only joinable with the code or invite link.</li>
              <li>The game is provided as is. We will do our best to keep it running and to fix problems you report.</li>
            </ul>
            {contact && <p>Contact: {contact}</p>}
          </section>
        )}
      </div>
    </div>
  );
}
