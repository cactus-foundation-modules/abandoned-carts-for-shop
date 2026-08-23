import type { EmailTemplateDef } from '@/lib/email/registry'

// The one email this module sends, declared for core's single email editor
// (Settings > Emails). Core owns the wording, the on/off switch, the design
// wrapped around it and the sending; this file is only the default.
//
// `itemList` is markup lib/emails.ts assembles, with the catalogue's own words
// escaped on the way in - hence rawTags. Every other tag is escaped by core, as
// normal.
//
// `unsubscribeUrl` is a required tag and stays required. This is a marketing
// email under any reading of PECR: it goes to somebody who left an address in a
// form and never placed an order, and it exists to bring them back. An edit that
// drops the way out is rejected rather than sent.

export const abandonedCartsEmailTemplates: EmailTemplateDef[] = [
  {
    key: 'abandoned-carts-for-shop.reminder',
    label: 'Basket reminder (to the shopper)',
    subject: 'You left something behind at {{siteName}}',
    bodyHtml:
      '<p>Hello{{#if hasName}} {{firstName}}{{/if}},</p>' +
      '<p>You were part way through an order with us and something got in the way. Your basket is still here:</p>' +
      '<ul>{{itemList}}</ul>' +
      '<p><a href="{{basketUrl}}">Pick up where you left off</a></p>' +
      '<p>If you have changed your mind, no harm done - this is the only nudge you will get about it.</p>' +
      '<p>{{siteName}}</p>' +
      '<p style="font-size:12px;color:#666">Would rather we did not? <a href="{{unsubscribeUrl}}">Stop these reminders</a>.</p>',
    mergeTags: ['siteName', 'firstName', 'itemList', 'basketUrl', 'unsubscribeUrl', 'itemCount', 'basketTotal'],
    requiredTags: ['unsubscribeUrl'],
    rawTags: ['itemList'],
    transactional: false,
  },
]
