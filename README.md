<p align="center">
  <img src="module-art.webp" alt="Abandoned Carts" width="640" />
</p>

# Abandoned Carts for Shop

Shows you the baskets nobody finished, and what the shopper had typed into the checkout before they went.

Every unfinished basket lands on a tab in **Trading**, with what was in it, roughly what it was worth, and whatever they got as far as filling in: name, email, phone, delivery address, discount code, chosen payment method. Optional reminder emails go to the ones who left an address.

The whole thing waits on your cookie banner. No agreement, nothing recorded.

## What it does

- **Baskets and started checkouts, in one list.** Filter between "basket only", "checkout started" and "came back", or read the lot.
- **Everything they typed.** Whatever was in the checkout boxes when they stopped, kept through a shopper who wanders back to the basket page and loses the form.
- **Says what actually went wrong.** A card that was refused, and a shopper who was sent off to their bank and never came back, are two different missed sales - and neither leaves an order anywhere on the site, because those methods write no order until the money is committed. Both are named in the list, with the refusal in the words the shopper was shown.
- **Marks its own successes.** A basket that turns into an order is closed and stamped with the order number, so the list tells you how many came back rather than only how many left.
- **Asks first, if you want it to.** Switch the reminders on and you are offered a permission box for the checkout: one tickbox directly under the email box, worded by you. Anybody who ticks it is left alone.
- **Optional reminders.** Off by default. On a delay you choose, at most three per basket, never to somebody who has since ordered, never again to somebody who has asked you to stop. Wording lives in **Settings › Emails** with every other email on the site.
- **Says whether the reminder actually went, and when.** Every attempt is written down - sent, would not send, or deliberately skipped, with the reason in plain English. The list carries it as a column; opening a basket shows the lot, in order, with who sent what by hand.
- **Send one now.** For the basket worth chasing today rather than in four hours' time. It refuses exactly what the automatic run refuses: an unsubscribe, a ticked permission box, no address, or a shopper who has already ordered.
- **Tells you whether the sender is even running.** A line under the figures says when the hourly job last went and what it did. A cron that has quietly stopped otherwise looks identical to a shop where nothing is due.
- **Figures worth quoting.** What is sitting unfinished and what it is worth, how many got as far as the checkout, what share came back, and how many reminders went in the last month.
- **Search, filter, sort, export.** By name, email, phone, postcode, discount code or order number; by date, by worth, by whether they can be emailed at all, by how the payment ended. Every combination is a link you can send somebody, and the CSV is whatever the screen is showing.
- **The unsubscribe list, visible.** Who has asked you to stop, when, and a way to put somebody back on if they ask you to.
- **Deletes itself on a schedule.** Baskets older than your retention setting go, whether they were reminded, recovered or neither. The record of reminders goes with them.

## Consent

This module records a name, an address and a phone number belonging to somebody who never placed an order, so it does not record anything until it is allowed to.

- It asks your site to carry the standard **Marketing** category, offered as a one-click suggestion on the Privacy tab.
- Nothing is written - no cookie, no basket, no typed details - until a shopper grants that category. Not answering the banner counts as not granting it.
- A shopper who withdraws consent has everything of theirs deleted, and the cookie identifying their browser cleared, on the spot.
- The gate is enforced twice: in the browser, and again on the server, where a hand-written request cannot slip past it.
- If your banner is switched off, or carries no Marketing category, there is nothing for anybody to agree to and capture runs for everyone. The settings panel says so, loudly, because it is your decision to make and your exposure if you make it carelessly.
- Every reminder email carries a working unsubscribe, and the suppression outlives the basket it came from. Clicking it lands exactly where ticking the checkout permission box lands, and then some: the address is suppressed for good, and their baskets are marked as asked-not-to-be-emailed so the list says why nothing was sent.
- The optional checkout permission box asks the shopper before any of it, which is a good deal politer than a link at the bottom of an email they did not want.
- A signed-in member's unfinished baskets are included in their own data export.

## Requirements

- Cactus core **0.5.1234** or newer
- The **Shop** module, **0.1.309** or newer
- An email provider configured, if you want the reminders

## How it captures

Installing the module drops an invisible **Abandoned basket tracker** block onto your header layout. It draws nothing; it watches the basket and the checkout boxes and reports them. If you ever delete it, capture stops - put it back from the block list on any header or footer layout.

The shop's basket lives in the browser until an order is placed, so this is the only place there is to watch it from. The module asks nothing of the Shop module itself: a site running the shop without this installed is byte-for-byte the shop it was.

## Settings

**Settings › Shop › Abandoned baskets.**

| Setting | Default | What it does |
| --- | --- | --- |
| Keep unfinished baskets | On | The master switch. Off means nothing is recorded and no reminders go out. |
| Include baskets that never reached the checkout | On | Off keeps only the ones where somebody started filling the checkout in. |
| Counts as abandoned after | 60 minutes | Drives the "Abandoned" badge and the earliest a reminder may go. |
| Delete baskets after | 90 days | Retention. Enforced by the hourly job, not by good intentions. |
| Email a reminder | Off | The reminders, and nothing sends while this is off. |
| Wait before the reminder | 240 minutes | Since they last touched the basket. |
| Reminders per basket | 1 | At most three. One is a favour, three is a habit. |
| Add an email permission box to the checkout | Off | Offered once the reminders are on. Adds one tickbox directly under the email box; ticking it stops the reminder for that basket. Never required, never holds an order up. |
| What the box says | "Don't email me about offers and similar products." | Your wording. Blank goes back to ours. |

### The permission box

It sits under the email box on the contact step, and appears once the shopper has typed an address - a question about emailing somebody is unanswerable before there is somebody to email.

Drawn by this module through the shop's `shop.checkout-contact-extras` point, so the shop itself carries nothing of it: a site running the shop without this module installed has the same checkout it always had, and uninstalling takes the box with it.

## Permissions

- `abandonedcarts.access` - see the list
- `abandonedcarts.manage` - change the settings, send a reminder by hand, delete a basket, put an address back on the list

Shop's own permissions deliberately do not grant either. Whoever may edit the catalogue is not automatically somebody who should be reading every shopper's address.

## Tables

`abc_carts`, `abc_suppressions`, `abc_settings`, `abc_reminder_log`, `abc_job_runs`. All declared for teardown, so uninstalling with data removal leaves nothing behind. The reminder log holds an email address, so it is on the same retention clock as the basket it belongs to and goes when that goes.

## Licence

MIT.
