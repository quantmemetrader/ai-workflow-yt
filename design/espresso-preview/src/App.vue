<template>
  <div class="flex h-screen w-screen bg-surface-white">
    <!-- module rail -->
    <div
      class="flex w-14 flex-shrink-0 flex-col items-center gap-1 border-r border-outline-gray-1 bg-surface-gray-2 py-2"
    >
      <div
        class="mb-2 flex size-8 items-center justify-center rounded bg-surface-gray-7 text-2xs font-medium text-ink-white"
      >
        AF
      </div>
      <button
        v-for="m in modules"
        :key="m.label"
        class="flex size-9 flex-col items-center justify-center rounded transition"
        :class="
          m.active
            ? 'bg-surface-white shadow-sm text-ink-gray-9'
            : 'text-ink-gray-5 hover:bg-surface-gray-3'
        "
        :title="m.label"
      >
        <component :is="m.icon" class="size-4" />
      </button>
      <div class="mt-auto">
        <Avatar label="Chan Ka-ming" size="md" />
      </div>
    </div>

    <!-- context sidebar -->
    <Sidebar :header="sidebarHeader" :sections="sidebarSections" disable-collapse />

    <!-- main -->
    <div class="flex min-w-0 flex-1 flex-col">
      <!-- page header -->
      <div
        class="flex h-12 flex-shrink-0 items-center gap-3 border-b border-outline-gray-1 px-4"
      >
        <Breadcrumbs :items="breadcrumbs" />
        <div class="ml-auto flex items-center gap-2">
          <Badge variant="subtle" theme="green" size="sm" label="Synced" />
          <Button variant="subtle" size="sm" label="Filter">
            <template #prefix><LucideListFilter class="size-4" /></template>
          </Button>
          <Button variant="solid" size="sm" label="Upload">
            <template #prefix><LucideUpload class="size-4" /></template>
          </Button>
        </div>
      </div>

      <!-- list -->
      <div class="flex min-h-0 flex-1 flex-col px-4 py-3">
        <ListView
          :columns="columns"
          :rows="rows"
          row-key="id"
          :options="{ selectable: true, showTooltip: true, rowHeight: 40 }"
        >
          <template #cell="{ item, row, column }">
            <template v-if="column.key === 'name'">
              <div class="flex items-center gap-2 truncate">
                <component :is="row.icon" class="size-4 shrink-0 text-ink-gray-5" />
                <span class="truncate text-base text-ink-gray-8">{{ item }}</span>
              </div>
            </template>
            <template v-else-if="column.key === 'kind'">
              <Badge variant="subtle" theme="gray" size="sm" :label="item" />
            </template>
            <template v-else-if="column.key === 'access'">
              <Badge
                variant="subtle"
                size="sm"
                :theme="accessTheme(item)"
                :label="item"
              />
            </template>
            <template v-else-if="column.key === 'owner'">
              <div class="flex items-center gap-2">
                <Avatar :label="item" size="xs" />
                <span class="truncate text-base text-ink-gray-7">{{ item }}</span>
              </div>
            </template>
            <template v-else>
              <span class="truncate text-base text-ink-gray-7 tabular-nums">{{
                item
              }}</span>
            </template>
          </template>
        </ListView>
      </div>

      <!-- footer -->
      <div
        class="flex h-10 flex-shrink-0 items-center gap-3 border-t border-outline-gray-1 px-4 text-xs text-ink-gray-5"
      >
        <span>18 files · 4.2 GB</span>
        <span class="text-ink-gray-4">·</span>
        <span>Filtered to what you can read</span>
        <div class="ml-auto flex items-center gap-2">
          <span>Storage</span>
          <Progress :value="46" size="sm" class="w-24" />
          <span class="tabular-nums">46%</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { Sidebar } from 'frappe-ui/src/components/Sidebar'
import { ListView } from 'frappe-ui/src/components/ListView'
import { Button } from 'frappe-ui/src/components/Button'
import { Badge } from 'frappe-ui/src/components/Badge'
import { Avatar } from 'frappe-ui/src/components/Avatar'
import { Breadcrumbs } from 'frappe-ui/src/components/Breadcrumbs'
import { Progress } from 'frappe-ui/src/components/Progress'

import LucideMessageSquare from '~icons/lucide/message-square'
import LucideFolder from '~icons/lucide/folder'
import LucideTrendingUp from '~icons/lucide/trending-up'
import LucideFileText from '~icons/lucide/file-text'
import LucideClapperboard from '~icons/lucide/clapperboard'
import LucideSend from '~icons/lucide/send'
import LucideBriefcase from '~icons/lucide/briefcase'
import LucideSettings2 from '~icons/lucide/settings-2'
import LucideListFilter from '~icons/lucide/list-filter'
import LucideUpload from '~icons/lucide/upload'
import LucideFileVideo from '~icons/lucide/file-video'
import LucideFileAudio from '~icons/lucide/file-audio'
import LucideFileImage from '~icons/lucide/file-image'
import LucideFileSpreadsheet from '~icons/lucide/file-spreadsheet'

const modules = [
  { label: 'Chat', icon: LucideMessageSquare },
  { label: 'Files', icon: LucideFolder, active: true },
  { label: 'Research', icon: LucideTrendingUp },
  { label: 'Script', icon: LucideFileText },
  { label: 'Video', icon: LucideClapperboard },
  { label: 'Publish', icon: LucideSend },
  { label: 'Back-office', icon: LucideBriefcase },
  { label: 'Admin', icon: LucideSettings2 },
]

const sidebarHeader = {
  title: 'Database',
  subtitle: 'Aura Farmers',
  logo: LucideFolder,
}

const sidebarSections = [
  {
    label: 'Folders',
    items: [
      { label: '2025 archive', icon: LucideFolder },
      { label: '2026-Q3-campaign', icon: LucideFolder },
      { label: 'Renders', icon: LucideFolder, isActive: true },
      { label: 'Scripts', icon: LucideFolder },
      { label: 'Footage', icon: LucideFolder },
      { label: 'Brand assets', icon: LucideFolder },
    ],
  },
  {
    label: 'Filters',
    collapsible: true,
    items: [
      { label: 'Recent', icon: LucideTrendingUp },
      { label: 'Shared with me', icon: LucideSend, suffix: '4' },
    ],
  },
]

const breadcrumbs = [
  { label: 'Database' },
  { label: '2026-Q3-campaign' },
  { label: 'Renders' },
]

const columns = [
  { label: 'Name', key: 'name', width: 3 },
  { label: 'Kind', key: 'kind', width: 1 },
  { label: 'Size', key: 'size', width: 1, align: 'right' },
  { label: 'Version', key: 'version', width: 1, align: 'right' },
  { label: 'Owner', key: 'owner', width: 2 },
  { label: 'Modified', key: 'modified', width: 1 },
  { label: 'Access', key: 'access', width: 1 },
]

const rows = [
  { id: '1', name: 'master-004_night-market_16x9.mp4', icon: LucideFileVideo, kind: 'video', size: '1.8 GB', version: 'v3', owner: 'Chan Ka-ming', modified: '2 Sep', access: 'Owner' },
  { id: '2', name: 'master-004_night-market_9x16.mp4', icon: LucideFileVideo, kind: 'video', size: '944 MB', version: 'v3', owner: 'Chan Ka-ming', modified: '2 Sep', access: 'Owner' },
  { id: '3', name: 'master-004_night-market_1x1.mp4', icon: LucideFileVideo, kind: 'video', size: '812 MB', version: 'v3', owner: 'Chan Ka-ming', modified: '2 Sep', access: 'Owner' },
  { id: '4', name: 'master-004_subtitles_zh-HK.srt', icon: LucideFileText, kind: 'asset', size: '14 KB', version: 'v2', owner: 'Leung Chi-hang', modified: '2 Sep', access: 'Editor' },
  { id: '5', name: 'master-004_cover_set.zip', icon: LucideFileImage, kind: 'asset', size: '6.4 MB', version: 'v1', owner: 'Leung Chi-hang', modified: '2 Sep', access: 'Editor' },
  { id: '6', name: 'roughcut-004_v2_watermarked.mp4', icon: LucideFileVideo, kind: 'video', size: '402 MB', version: 'v2', owner: 'Amy Wong', modified: '1 Sep', access: 'Editor' },
  { id: '7', name: 'voiceover_zh-HK_take3.wav', icon: LucideFileAudio, kind: 'asset', size: '88 MB', version: 'v3', owner: 'Amy Wong', modified: '1 Sep', access: 'Editor' },
  { id: '8', name: 'render-report_2026-09-02.pdf', icon: LucideFileText, kind: 'report', size: '240 KB', version: 'v1', owner: 'Michelle Yip', modified: '2 Sep', access: 'Viewer' },
  { id: '9', name: 'comment-export_yt_aug.csv', icon: LucideFileSpreadsheet, kind: 'comment_export', size: '1.1 MB', version: 'v1', owner: 'Amy Wong', modified: '31 Aug', access: 'Viewer' },
  { id: '10', name: 'broll_temple-street_4k.mov', icon: LucideFileVideo, kind: 'video', size: '2.9 GB', version: 'v1', owner: 'Tony Wu', modified: '28 Aug', access: 'Viewer' },
]

function accessTheme(v) {
  if (v === 'Owner') return 'blue'
  if (v === 'Editor') return 'green'
  return 'gray'
}
</script>
