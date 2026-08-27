# 智能体群组与任务分发 / Agent Teams & Task Distribution

把本机的多个 AI 助手拉进同一个群组，由一位 **Leader**（协调员）理解你的目标、拆解工作、分派给成员并汇总结果——你只对一个 Leader 说话。

Put multiple on-device AI assistants into one group. A **Leader** understands your goal, breaks the work down, distributes it to members and summarizes results — you only talk to the Leader.

---

## 中文

### 新建群组

1. 左侧导航打开 **智能体群组**，点击 **新建智能体群组**；
2. 输入团队名称，从本机已检测到的助手中挑选成员（同一助手可以添加多次，例如让两个 SearchT CLI 并行干不同的活）；
3. 指定其中一位为 **Leader（⚑）**：Leader 负责理解目标、拆解并协调，其余成员听 Leader 指挥；
4. 可选：为团队指定一个工作目录（成员的产物会落在团队工作区内）；
5. 点击创建，系统会 **唤醒** 全体成员；个别成员启动失败时，可在弹出的面板里切换其模型后重试，或先移除再试。

> 目前支持 SearchT CLI 与 Claude Code 作为成员，更多助手适配中。没有合适的成员？创建后可以直接让 Leader 在对话里帮你物色、添加临时队员。

### 任务分发是如何工作的

- 在输入框向 **Leader 描述目标**（例如"组织一场辩论赛，让不同助手各持立场"），Leader 拆解工作并逐一分派给成员；
- 输入 **@** 可以提及具体成员，或选择 **@全体成员** 广播；
- 打开 **任务与交接** 面板，可以实时看到：谁在做什么、完成了几项、哪些任务被其它任务阻塞、附件产物；
- 点击成员可 **查看成员会话** 或 **打开完整会话**，了解每个成员的推理过程；
- 成员工作中收到的新消息会自动 **排队**，按顺序处理，不会丢。

### 成员管理

- 随时 **添加成员**（搜索助手、同一助手可反复添加），或直接 **告诉 Leader**"帮我加一个擅长 XX 的成员"；
- 移除成员：工作中的成员被移除时其当前任务会被中断，会有确认提示；
- 支持拖动调整成员顺序。

### 失败与恢复

- 成员启动失败：在唤醒面板中切换模型重试；
- 成员运行中出错：任务面板与成员会话中可看到失败原因，Leader 会收到通知并可重新分派；
- 全群会话可随时停止。

---

## English

### Create a team

1. Open **Agent Teams** in the left sidebar and click **New Team**;
2. Name the team and pick members from the locally detected assistants (the same assistant can be added multiple times — e.g. two SearchT CLI instances working in parallel);
3. Mark one member as the **Leader (⚑)**: the Leader understands goals, breaks work down and coordinates; the other members follow the Leader;
4. Optional: choose a working directory for the team (member artifacts land inside the team workspace);
5. Create — the team is **warmed up** together. If a member fails to start, switch its model in the warm-up panel and retry, or remove it first.

> SearchT CLI and Claude Code are currently supported as members; more assistants are on the way. No suitable member? Just ask the Leader to recruit and add a temporary one right in the conversation.

### How task distribution works

- **Describe the goal to the Leader** (e.g. "run a debate where different assistants hold different positions"); it decomposes the work and assigns it piece by piece;
- Type **@** to mention a specific member, or pick **@all members** to broadcast;
- The **Tasks & Handoffs** panel shows, in real time: who is doing what, completed counts, tasks blocked by others, and attachments;
- Click a member to **inspect its conversation** or open the full transcript to follow its reasoning;
- Messages that arrive while a member is busy are **queued** and processed in order — nothing is lost.

### Member management

- **Add members** any time (search assistants; duplicates allowed), or just **tell the Leader** "add a member good at X";
- Removing a working member interrupts its current task (a confirmation prompt appears);
- Drag to reorder members.

### Failures & recovery

- Member failed to start: switch its model in the warm-up panel and retry;
- Member errors mid-run: the cause is visible in the tasks panel and the member's conversation; the Leader is notified and can reassign;
- The whole team session can be stopped at any time.
