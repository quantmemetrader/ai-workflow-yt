/**
 * The 腾亚 mark.
 *
 * Styled on the look of the channel's YouTube picture (@yafanghk) — the warm
 * gold-to-steel light, and the small white label with heavy black type and a
 * sparkle — but never the founder's face: that picture is a headshot, not a
 * company mark (CLIENT-BACKLOG.md, P4).
 *
 * The two characters are *outlines*, not text. They were cut from
 * assets/NotoSansSC.ttf at weight 900 (fontTools: instantiateVariableFont →
 * SVGPathPen), because text would be drawn by whatever font each device has —
 * the same wrong-glyph trap the Chinese-rendering fix was about — and the
 * favicon renderer (`next/og`) would take that variable font's default
 * weight, which is 100, a hairline. As paths it is the same mark everywhere.
 *
 * Coordinates are font units (1000 per em, y up); the transform below places
 * them in the 100×100 tile.
 */

const TENG = "M388 719H947V613H388ZM366 571H970V462H366ZM825 562Q849 511 894.5 467.5Q940 424 998 401Q977 384 952.5 354.0Q928 324 914 301Q847 335 796.5 396.5Q746 458 717 531ZM786 849 917 815Q900 781 884.5 750.5Q869 720 857 698L748 729Q759 755 770.0 788.5Q781 822 786 849ZM590 855 717 842Q689 647 617.5 512.0Q546 377 412 297Q404 310 388.5 329.0Q373 348 356.0 366.5Q339 385 326 396Q449 459 510.0 574.5Q571 690 590 855ZM398 821 506 851Q521 825 532.5 792.5Q544 760 548 736L434 702Q432 726 422.0 759.5Q412 793 398 821ZM808 260H931Q931 260 930.5 243.0Q930 226 928 214Q922 133 915.0 79.0Q908 25 898.5 -6.0Q889 -37 875 -52Q859 -71 840.5 -78.5Q822 -86 799 -89Q780 -91 749.5 -91.5Q719 -92 684 -91Q683 -65 673.5 -34.0Q664 -3 650 19Q678 17 702.5 16.0Q727 15 740 15Q751 15 758.0 17.0Q765 19 772 25Q780 33 786.5 57.5Q793 82 798.5 127.5Q804 173 808 244ZM463 415H738V317H463ZM703 415H832Q824 369 814.0 321.5Q804 274 795 239L668 243Q678 279 687.5 325.5Q697 372 703 415ZM467 304 590 294Q584 260 577.0 222.0Q570 184 562 157H437Q445 188 453.5 228.0Q462 268 467 304ZM501 260H835V157H501ZM394 130H750V36H394ZM114 821H295V690H114ZM114 596H295V465H114ZM114 367H295V233H114ZM61 821H177V454Q177 394 175.0 323.0Q173 252 167.0 177.5Q161 103 149.0 33.5Q137 -36 118 -92Q107 -83 87.5 -71.5Q68 -60 48.0 -50.0Q28 -40 13 -35Q30 17 40.0 79.0Q50 141 54.5 206.5Q59 272 60.0 335.0Q61 398 61 453ZM237 821H355V43Q355 3 348.0 -23.0Q341 -49 318 -65Q296 -81 266.5 -85.0Q237 -89 196 -89Q194 -64 184.5 -28.0Q175 8 164 32Q182 31 199.5 30.5Q217 30 224 31Q237 31 237 46Z";
const YA = "M25 88H971V-51H25ZM292 743H452V-13H292ZM542 743H702V-22H542ZM786 579 930 534Q913 468 893.0 402.5Q873 337 852.5 278.0Q832 219 813 173L681 217Q701 264 721.0 325.5Q741 387 758.5 453.0Q776 519 786 579ZM60 528 189 576Q210 519 234.0 453.5Q258 388 278.5 326.5Q299 265 311 218L170 158Q160 206 141.5 269.5Q123 333 101.5 401.0Q80 469 60 528ZM64 802H942V658H64Z";

/**
 * A 100×100 tile. `id` keeps two marks' gradients apart on one page; `square`
 * is for iOS, which rounds the icon itself and paints transparent corners
 * black.
 */
export function brandMarkSvg(size: number, opts: { id?: string; square?: boolean } = {}): string {
  const id = opts.id ?? "ty";
  // 0.036 units per font unit: the pair is ~71 wide, ~34 tall, centred on the
  // label. The second character sits 960 units on, a little tighter than the
  // em, as a lettered mark is.
  const glyphs = `<g fill="#111111" transform="translate(14.3 65.7) scale(0.036 -0.036)"><path d="${TENG}"/><path transform="translate(960 0)" d="${YA}"/></g>`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100" role="img" aria-label="腾亚">`,
    `<defs><linearGradient id="${id}-bg" x1="0" y1="0" x2="1" y2="1">`,
    `<stop offset="0" stop-color="#efca96"/><stop offset="0.38" stop-color="#caae7e"/><stop offset="0.72" stop-color="#757671"/><stop offset="1" stop-color="#40535a"/>`,
    `</linearGradient></defs>`,
    `<rect width="100" height="100" rx="${opts.square ? 0 : 22}" fill="url(#${id}-bg)"/>`,
    // The picture's soft vertical light — a skyline, or a chart — low right.
    `<g fill="#ffffff" opacity="0.16"><rect x="58" y="62" width="5" height="38"/><rect x="66" y="50" width="4" height="50"/><rect x="73" y="70" width="6" height="30"/><rect x="82" y="56" width="4" height="44"/><rect x="89" y="66" width="5" height="34"/></g>`,
    // The white label, lifted off the tile the way the picture's cut-out is.
    `<rect x="7" y="30.5" width="86" height="46" rx="9" fill="#000000" opacity="0.18"/>`,
    `<rect x="7" y="29" width="86" height="46" rx="9" fill="#ffffff"/>`,
    glyphs,
    // The sparkle at the label's corner.
    `<path d="M86 12 L88.2 19.8 L96 22 L88.2 24.2 L86 32 L83.8 24.2 L76 22 L83.8 19.8 Z" fill="#ffffff"/>`,
    `</svg>`,
  ].join("");
}

/** The same mark as a data URI, for `<img>` and for `next/og`. */
export function brandMarkDataUri(size: number, opts: { square?: boolean } = {}): string {
  // Base64, not `utf8,`: `next/og` decodes the URI with atob, which throws
  // on the percent-escapes of 腾亚 and failed the build.
  return `data:image/svg+xml;base64,${Buffer.from(brandMarkSvg(size, opts)).toString("base64")}`;
}
