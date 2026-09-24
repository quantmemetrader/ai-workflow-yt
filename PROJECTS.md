# Projects — the source of truth

Decided 2026-09-25 by the owner: **everything lives under a project.** A project is one piece
of work (almost always one video). Starting any work makes a project; all AI-employee chat
about it happens inside it; its script, clips, cuts and renders belong to it; it can be shared
like a video (private, everyone, groups, people, guests).

## What a project holds
- Title, brief (what it is about), source (a pick with evidence, the morning brief, a person).
- Its own chat with the five employees. Tagged employees work *inside* the project: its script
  and video project are the ones open (`mentions.ts` passes them as tool context).
- One script, one video project (clips, timeline, captions, graphics, renders).
- Status: active, done (delivered), archived. Mode: full line, or direct (straight to one employee).
- Access: private to the creator, everyone in the studio, chosen groups, chosen people (guests
  included only when named). Access flows down to the chat, the script and the video project.

## Every way in (each makes or opens a project)
1. Home task box: "+ New project" (default) or an existing project; lands on its page.
2. Sidebar tree: "+ New project", or open any project.
3. Research: a pick's "Start project" (title, brief and evidence carried over).
4. Morning brief: each signal's "Start project" button.
5. Script library "New script" and Video "New project": both create a project.
6. A link `/projects/new?title=…&brief=…` shows a one-press confirm (used by buttons that
   cannot run an action, like chat cards).

## Where you see projects
- Sidebar: a tree under Home. Open project expanded: Overview & chat, Script, Editor.
- Home: projects in progress (steps and where each stands), and their chats: last messages from
  every active project, open one to read on and reply without leaving Home.
- /projects: all of them, filter by status and by mine/shared, search by name.
- Script and Video pages of a project's script or video show a project bar (back to the
  project; Overview · Script · Editor), so you never feel you left it.

## The project page
- Header: title (rename), status, share, archive.
- Steps: topic → script → host's clips → edit → approve & deliver (skipped steps hatched).
- Outputs: script (open, ask the writer), clips (upload in place), video (plays in place;
  deliver, shorter, new opening).
- Chat on the right: @ any employee, replies go to whoever spoke last, card buttons work.

## Rules
- No work outside a project. #制作 remains only as the studio-wide feed.
- An employee may never claim work it did not do with a tool (guard in `mentions.ts`).
- Line icons only (`components/ui/Icon.tsx`), never emoji.
