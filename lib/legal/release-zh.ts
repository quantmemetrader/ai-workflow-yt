/**
 * 出镜同意与肖像授权书, in Simplified Chinese.
 *
 * 3 Oct: first version. 4 Oct: revised after a Hong Kong lawyer's review —
 * stated consideration (so the release is binding), a release of claims,
 * sublicensing and assignment to distributors and platforms, a minor clause,
 * the PDPO transferee classes and an access/correction contact, a fuller party
 * block, non-exclusive jurisdiction, 永久有效 and an entire-agreement clause.
 * The earlier text is kept in `./builtin-history`, which is how a studio's
 * unedited copy is upgraded and an older contract is still reviewed against
 * the text it came from.
 *
 * The English release (`./release-en`) has the same fields, so `resolveDraft`
 * and clause review treat both alike. Every field added on 4 Oct is optional:
 * left blank it takes the default in `./fill` (a blank line to sign over, or
 * the studio), never a `{{ … }}`. Clauses are numbered 第一条, 第二条… which
 * `splitClauses` in `./compare` reads as 1, 2…; the party block above them and
 * the signing block below are compared as sections of their own.
 *
 * `builtinKey` is what makes adding it idempotent: the service inserts it on
 * read, on conflict with (tenant_id, builtin_key) does nothing.
 */
export const RELEASE_ZH = {
  builtinKey: "release.zh",
  name: "出镜同意与肖像授权书（中文）",
  kind: "release",
  fields: [
    { key: "contributor", label: "出镜人姓名" },
    { key: "production", label: "节目或哪一集" },
    { key: "recorded_on", label: "拍摄日期" },
    { key: "territory", label: "授权地区", hint: "默认全球，出镜人另有要求时再改" },
    { key: "consideration", label: "对价", hint: "默认：参与本节目拍摄的机会及象征性对价港币1元" },
    { key: "contributor_id", label: "出镜人身份证或护照号码", hint: "选填，留空则留出横线手写" },
    { key: "contributor_address", label: "出镜人地址", hint: "选填，留空则留出横线手写" },
    { key: "guardian", label: "监护人姓名", hint: "出镜人未满18岁时填写，否则留空" },
    { key: "studio_legal_name", label: "制作方法定名称", hint: "默认用工作室名称" },
    { key: "studio_registration_no", label: "制作方商业登记号码", hint: "选填，留空则留出横线手写" },
    { key: "studio_signatory", label: "制作方签署人姓名", hint: "选填，留空则留出横线手写" },
    { key: "studio_signatory_title", label: "制作方签署人职位", hint: "选填，留空则留出横线手写" },
    { key: "data_contact", label: "个人资料查阅及更正的联络人", hint: "默认被授权方" },
  ],
  body: `出镜同意与肖像授权书

授权人（出镜人）：{{ contributor }}
身份证或护照号码：{{ contributor_id }}
地址：{{ contributor_address }}
（以下简称“授权人”）

被授权方（制作方）：{{ studio_legal_name }}
商业登记号码：{{ studio_registration_no }}
（以下简称“被授权方”）

被授权方正在制作「{{ production }}」（以下简称“本节目”），授权人同意参与本节目的拍摄。双方经协商一致，订立本授权书如下：

第一条　拍摄
授权人同意参与本节目的拍摄，拍摄日期为{{ recorded_on }}。授权人同意被授权方在拍摄过程中录制其影像、声音、言谈及表演（以下简称“出镜内容”）。

第二条　授权范围
授权人授予被授权方以下权利：为本节目及其宣传推广之目的，以现有或日后出现的任何媒体及方式，录制、剪辑、复制、发行、展示、播放、传播及公开发布授权人的姓名、肖像、声音、简介及出镜内容。使用方式包括但不限于：被授权方或其合作方经营的网站、社交媒体及视频平台（如 YouTube、Facebook、Instagram、抖音、哔哩哔哩、微信视频号、小红书等）、电视及流媒体服务，以及本节目的预告片、精华片段、封面、海报和其他宣传材料。

第三条　转授权及转让
被授权方可将本授权书项下的全部或部分权利转授权或转让予本节目的发行商、播出平台、合作制作方及其继受人，以便本节目的发行、播放及宣传。受让方及转授权人同样受第七条及第十条的约束。

第四条　授权地区
本授权的使用地区为：{{ territory }}。

第五条　授权期限
本授权自双方签署之日起生效，除按第十条撤回外，永久有效。

第六条　对价
授权人作出本授权所取得的对价为：{{ consideration }}。授权人确认已收到该对价，且该对价充分。除双方另行签订书面协议外，被授权方无须就本授权向授权人支付任何其他费用。

第七条　剪辑与精神权利
授权人理解并同意：出镜内容将经剪辑后使用，最终成片由被授权方决定；被授权方可（但无义务）在本节目中注明授权人姓名。被授权方承诺不以歪曲、丑化授权人的方式使用出镜内容，亦不将其用于与本节目无关的商业代言。在此前提下，授权人在适用法律允许的范围内，不就被授权方的合理剪辑行使其精神权利或提出异议。

第八条　授权人保证
授权人确认：其在出镜内容中所发表的言论为其本人观点；其有权签署本授权书，且签署和履行本授权书不违反其对任何第三方所负的义务。

第九条　放弃申索
在适用法律允许的范围内，授权人放弃并解除其因被授权方、其转授权人或受让方按本授权书使用出镜内容而可能享有的一切申索，包括基于私隐、诽谤、形象权（公开权）及肖像权的申索。被授权方违反第七条承诺的，本条不影响授权人的权利。

第十条　撤回
授权人可在本节目公开发布前，以书面形式通知被授权方撤回本授权。本节目公开发布后，被授权方、其转授权人及受让方无须删除已发布的内容，但未经授权人再次同意，不会在新的作品中使用其出镜内容。

第十一条　未成年人
授权人签署本授权书时如未满18岁，本授权书须由其父母或法定监护人签署。父母或法定监护人签署即表示其代表授权人同意本授权书的全部条款，并确认其有权代表授权人作出本授权。

第十二条　个人资料
被授权方收集授权人的个人资料（包括姓名、联系方式、身份证明文件号码及影像），仅用于本节目的制作、发布、宣传及存档，以及履行本授权书。为上述目的，被授权方可将该等资料转移予以下类别的人士：本节目的合作制作方、发行商及播出平台（包括位于香港以外地区的平台），以及为被授权方提供服务的专业顾问及服务供应商。资料的保存期限以达到上述目的所需为限，并按照香港《个人资料（私隐）条例》（第486章）处理。授权人有权查阅及更正其个人资料，相关要求请以书面形式向{{ data_contact }}提出。

第十三条　适用法律及争议解决
本授权书受香港特别行政区法律管辖，并按其解释。因本授权书引起的或与之有关的争议，双方应先友好协商；协商不成的，双方同意接受香港特别行政区法院的非专属管辖。

第十四条　完整协议
本授权书构成双方就其所述事项的完整协议，取代双方此前就该事项作出的一切口头或书面的协商、陈述及理解。对本授权书的任何修改，须以书面形式作出并经双方签署方可生效。本授权书一式两份，双方各执一份。

授权人签署：____________________　日期：____________
{{ contributor }}

授权人未满18岁的，由父母或法定监护人签署：
监护人签署：____________________　日期：____________
监护人姓名：{{ guardian }}
与授权人的关系：____________________

被授权方签署：____________________　日期：____________
代表 {{ studio_legal_name }}
签署人姓名：{{ studio_signatory }}
职位：{{ studio_signatory_title }}`,
};
