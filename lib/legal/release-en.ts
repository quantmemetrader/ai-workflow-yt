/**
 * Contributor and likeness release, in English.
 *
 * Revised on 4 Oct alongside the Chinese release (`./release-zh`), with the
 * same substance and the same fields: consideration, a release of claims,
 * sublicensing and assignment, a minor clause, PDPO transferees and an access
 * contact, a fuller party block, non-exclusive jurisdiction, a perpetual term
 * and an entire-agreement clause. The studio is named by the
 * `studio_legal_name` field, never by the tenant's (usually Chinese) name
 * dropped into English text; see `fieldDefaults` in `./fill`. The earlier text
 * is in `./builtin-history`.
 *
 * A plain module, so a script can load it without a database.
 */
export const RELEASE_EN = {
  builtinKey: "release.en",
  name: "Contributor and likeness release",
  kind: "release",
  fields: [
    { key: "contributor", label: "Contributor's full name" },
    { key: "production", label: "Production or episode" },
    { key: "recorded_on", label: "Date of recording" },
    { key: "territory", label: "Territory", hint: "Worldwide, unless the contributor asks otherwise" },
    { key: "consideration", label: "Consideration", hint: "Default: the opportunity to take part and a nominal HK$1" },
    { key: "contributor_id", label: "Contributor's ID card or passport number", hint: "Optional; left blank, a line to write on" },
    { key: "contributor_address", label: "Contributor's address", hint: "Optional; left blank, a line to write on" },
    { key: "guardian", label: "Parent or guardian's name", hint: "Only if the contributor is under 18" },
    { key: "studio_legal_name", label: "Studio's legal name (in English)", hint: "Optional; left blank, a line to write on" },
    { key: "studio_registration_no", label: "Studio's business registration number", hint: "Optional; left blank, a line to write on" },
    { key: "studio_signatory", label: "Studio signatory's name", hint: "Optional; left blank, a line to write on" },
    { key: "studio_signatory_title", label: "Studio signatory's title", hint: "Optional; left blank, a line to write on" },
    { key: "data_contact", label: "Contact for personal data requests", hint: "Default: the Studio" },
  ],
  body: `CONTRIBUTOR AND LIKENESS RELEASE

Contributor: {{ contributor }}
ID card or passport number: {{ contributor_id }}
Address: {{ contributor_address }}
(the "Contributor")

Studio: {{ studio_legal_name }}
Business registration number: {{ studio_registration_no }}
(the "Studio")

The Studio is producing {{ production }} (the "Production"), and the Contributor agrees to take part in it on the terms below.

1. Recording. The Contributor agrees to take part in the Production, recorded on {{ recorded_on }}, and agrees that the Studio may record their image, voice, words and performance (the "Contribution").

2. Grant. The Contributor grants the Studio the right to record, edit, reproduce, distribute, publish, broadcast and make available their name, likeness, voice, biography and the Contribution, as part of the Production and its promotion, in any media now known or later devised. This includes websites, social media and video platforms run by the Studio or its partners, television and streaming services, and trailers, highlights, thumbnails, posters and other promotional material.

3. Sublicence and assignment. The Studio may sublicense or assign any or all of these rights to distributors, broadcasters, platforms and co-producers of the Production and their successors, so that the Production can be distributed, shown and promoted. Sublicensees and assignees are bound by clauses 7 and 10 in the same way.

4. Territory. This permission applies in the following territory: {{ territory }}.

5. Term. This permission takes effect when both parties have signed and continues in perpetuity, unless withdrawn under clause 10.

6. Consideration. In return for this permission the Contributor receives: {{ consideration }}. The Contributor acknowledges receipt and sufficiency of that consideration. No other payment is due for this permission unless a separate written agreement says otherwise.

7. Editing and moral rights. The Contributor understands that the Contribution will be edited and that the Studio decides the final cut; the Studio may, but need not, credit the Contributor by name. The Studio will not use the Contribution in a way that distorts or ridicules the Contributor, or for a commercial endorsement unrelated to the Production. On that basis, and to the extent the law allows, the Contributor will not exercise moral rights or object to reasonable editing.

8. Warranty. The Contributor confirms that what they say in the Contribution is their own view, that they are free to sign this release, and that signing and performing it does not breach any obligation they owe to anyone else.

9. Release of claims. To the extent the law allows, the Contributor waives and releases any claim against the Studio, its sublicensees and assignees arising from use of the Contribution in accordance with this release, including claims in privacy, defamation, publicity and likeness. This does not affect the Contributor's rights if the Studio breaks its promise in clause 7.

10. Withdrawal. The Contributor may withdraw before publication by writing to the Studio. After publication the Studio, its sublicensees and assignees are not required to remove material already published, but will not use the Contribution in a new production without the Contributor's further consent.

11. Minors. If the Contributor is under 18 when signing, this release must be signed by a parent or legal guardian, who by signing consents to all of its terms on the Contributor's behalf and confirms they have authority to do so.

12. Personal data. The Studio collects the Contributor's personal data (including name, contact details, identity document number and image) only to make, publish, promote and archive the Production and to perform this release. For those purposes it may transfer the data to the following classes of transferees: co-producers, distributors and platforms of the Production (including platforms outside Hong Kong), and professional advisers and service providers to the Studio. The data is kept only as long as those purposes require and is handled under the Personal Data (Privacy) Ordinance (Cap. 486). The Contributor may ask to access or correct their personal data by writing to {{ data_contact }}.

13. Governing law and jurisdiction. This release is governed by and construed under the laws of the Hong Kong Special Administrative Region. The parties will first try to settle any dispute arising from it by discussion, and submit to the non-exclusive jurisdiction of the courts of Hong Kong.

14. Entire agreement. This release is the entire agreement between the parties about its subject and replaces any earlier discussion, representation or understanding, oral or written. Any change to it must be in writing and signed by both parties. It is signed in two copies, one for each party.

Signed: ____________________   Date: ____________
{{ contributor }}

If the Contributor is under 18, signed by a parent or legal guardian:
Signed: ____________________   Date: ____________
Name: {{ guardian }}
Relationship to the Contributor: ____________________

Signed: ____________________   Date: ____________
for {{ studio_legal_name }}
Name: {{ studio_signatory }}
Title: {{ studio_signatory_title }}`,
};
