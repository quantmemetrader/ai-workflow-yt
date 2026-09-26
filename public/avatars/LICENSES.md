# Profile pictures: where they come from

The pictures in this folder are the ones anybody in the studio can choose as
their profile picture, and the ones people are given by default
(`lib/avatars/catalog.ts`, `lib/avatars/default.ts`). They were generated once
as static SVG files; nothing is fetched from anywhere at run time.

No picture here was taken from Pinterest or any other site. The owner asked for
"good pfps from Pinterest"; images on Pinterest belong to the people who made
them, so these are freely licensed illustrated styles with the same feel.

## `notionists/01.svg` to `notionists/12.svg`

- Artwork: "Notionists" by Zoish — <https://heyzoish.gumroad.com/l/notionists>
- Remix: DiceBear, style "notionists" (`@dicebear/notionists` 9.4) —
  <https://www.dicebear.com/styles/notionists/>
- Licence: CC0 1.0 Universal (public domain dedication) —
  <https://creativecommons.org/publicdomain/zero/1.0/>
- DiceBear's licence page: <https://www.dicebear.com/licenses/>

## `lorelei/01.svg` to `lorelei/12.svg`

- Artwork: "Lorelei" by Lisa Wischofsky —
  <https://www.figma.com/community/file/1198749693280469639>
- Remix: DiceBear, style "lorelei" (`@dicebear/lorelei` 9.4) —
  <https://www.dicebear.com/styles/lorelei/>
- Licence: CC0 1.0 Universal (public domain dedication) —
  <https://creativecommons.org/publicdomain/zero/1.0/>

CC0 asks for no attribution; the credit is given anyway. Each of these files
also carries its source and licence in its own `<metadata>` block, as DiceBear
writes it. The DiceBear library itself (MIT) was only used to draw the files
and is not part of this app.

How they were made: `createAvatar` from `@dicebear/core` with a fixed seed per
picture, the soft tints of the app's palette as backgrounds (#d5e7fb, #dcd6fb,
#f8dcc6, #c3e6e0, #f5d4e6, #fdefc3, #d8f0df), no gestures or body icons, and
only the smiling mouths for Lorelei. The seeds were picked by eye from sixty
candidates per style for friendly, varied, work-appropriate faces.
