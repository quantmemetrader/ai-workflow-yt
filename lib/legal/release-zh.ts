/**
 * 出镜同意与肖像授权书, in Simplified Chinese (3 Oct).
 *
 * The same fields and `{{ … }}` placeholders as the English release in
 * `./service` (studio, contributor, production, recorded_on, territory), so
 * `fillTemplate` / `resolveDraft` and clause review treat both alike. Clauses
 * are numbered 第一条, 第二条… which `splitClauses` in `./compare` reads as
 * 1, 2… A plain module, so a script can load it without a database.
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
  ],
  body: `出镜同意与肖像授权书

授权人（出镜人）：{{ contributor }}
被授权方（制作方）：{{ studio }}

被授权方正在制作「{{ production }}」（下称“本节目”），授权人同意参与本节目的拍摄。双方经协商一致，订立本授权书如下：

第一条　拍摄
授权人同意参与本节目的拍摄，拍摄日期为{{ recorded_on }}。授权人同意被授权方在拍摄过程中录制其影像、声音、言谈及表演（下称“出镜内容”）。

第二条　授权范围
授权人授予被授权方以下权利：为本节目及其宣传推广之目的，录制、剪辑、复制、发行、展示、播放、传播及公开发布授权人的姓名、肖像、声音及出镜内容。使用方式包括但不限于：被授权方或其合作方经营的网站、社交媒体及视频平台（如 YouTube、Facebook、Instagram、抖音、哔哩哔哩、微信视频号、小红书等）、电视及流媒体服务，以及本节目的预告片、精华片段、封面、海报和其他宣传材料。

第三条　授权地区
本授权的使用地区为：{{ territory }}。

第四条　授权期限
本授权自双方签署之日起生效，除按第八条撤回外，长期有效。

第五条　报酬
本授权为无偿授权。除双方另行签订书面协议外，被授权方无须就本授权向授权人支付任何费用。

第六条　剪辑与精神权利
授权人理解并同意：出镜内容将经剪辑后使用，最终成片由被授权方决定；被授权方可（但无义务）在本节目中注明授权人姓名。被授权方承诺不以歪曲、丑化授权人的方式使用出镜内容，亦不将其用于与本节目无关的商业代言。在此前提下，授权人在适用法律允许的范围内，不就被授权方的合理剪辑行使其精神权利或提出异议。

第七条　授权人保证
授权人确认：其在出镜内容中所发表的言论为其本人观点；其有权签署本授权书，且签署和履行本授权书不违反其对任何第三方所负的义务。

第八条　撤回
授权人可在本节目公开发布前，以书面形式通知被授权方撤回本授权。本节目公开发布后，被授权方无须删除已发布的内容，但未经授权人再次同意，不会在新的作品中使用其出镜内容。

第九条　个人资料
被授权方仅为本节目的制作、发布及存档之目的收集和使用授权人的个人资料（包括联系方式及影像），保存期限以达到上述目的所需为限，并按照香港《个人资料（私隐）条例》（第486章）处理。授权人可按该条例要求查阅或更正其个人资料。

第十条　适用法律及争议解决
本授权书受香港特别行政区法律管辖，并按其解释。因本授权书引起的或与之有关的争议，双方应先友好协商；协商不成的，任何一方均可提交香港特别行政区法院处理。

第十一条　其他
本授权书一式两份，双方各执一份，自双方签署之日起生效。本授权书未尽事宜，以双方另行签订的书面协议为准。

授权人签署：____________________　日期：____________
{{ contributor }}

被授权方签署：____________________　日期：____________
代表 {{ studio }}`,
};
