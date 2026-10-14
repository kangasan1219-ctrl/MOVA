// ==========================================
// MOVA — Turn plans into progress.
// Goals, recurring schedules, tasks and focus timer
// ==========================================

const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) =>
  Array.from(parent.querySelectorAll(selector));

const STORAGE_KEY = "mova-app-v1";

const CATEGORY_NAMES = {
  personal: "개인",
  study: "학습",
  work: "업무",
  health: "건강",
  life: "생활",
};

const WEEKDAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];

function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function shiftDate(dateString, amount) {
  const date = new Date(`${dateString}T12:00:00`);
  date.setDate(date.getDate() + amount);
  return localDateString(date);
}

function formatDate(dateString, options = {}) {
  if (!dateString) return "";
  const date = new Date(`${dateString}T12:00:00`);
  return new Intl.DateTimeFormat("ko-KR", options).format(date);
}

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function makeId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function loadData() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && Array.isArray(saved.goals) && Array.isArray(saved.tasks)) {
      return saved;
    }
  } catch (error) {
    console.warn("MOVA 저장 데이터를 불러오지 못했습니다.", error);
  }

  return { goals: [], tasks: [] };
}

let state = loadData();
let editingGoalId = null;
let editingTaskId = null;
let activeTaskId = null;
let timerInterval = null;
let timerSeconds = 300;
let timerRunning = false;
let toastTimeout = null;
let currentPage = "dashboard";

function saveData() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.error("MOVA 데이터를 저장하지 못했습니다.", error);
    showToast("저장 공간을 확인해 주세요.");
  }
}

function getGoal(goalId) {
  return state.goals.find((goal) => goal.id === goalId);
}

function getTask(taskId) {
  return state.tasks.find((task) => task.id === taskId);
}

function getGoalTasks(goalId) {
  return state.tasks.filter((task) => task.goalId === goalId);
}

function getTodayTasks() {
  const today = localDateString();
  return state.tasks
    .filter((task) => task.date === today)
    .sort((a, b) => (a.startTime || "23:59").localeCompare(b.startTime || "23:59"));
}

function showToast(message) {
  const toast = $("#toast");
  if (!toast) return;

  toast.textContent = message;
  toast.classList.add("show");

  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.classList.remove("show");
  }, 2600);
}

function openDialog(id) {
  const dialog = document.getElementById(id);
  if (dialog && typeof dialog.showModal === "function") {
    dialog.showModal();
  }
}

function closeDialog(id) {
  const dialog = document.getElementById(id);
  if (dialog && dialog.open) dialog.close();
}

function setPage(pageName) {
  const validPages = ["dashboard", "goals", "schedule"];
  if (!validPages.includes(pageName)) return;

  currentPage = pageName;

  const pageIds = {
    dashboard: "dashboard-page",
    goals: "goals-page",
    schedule: "schedule-page",
  };

  Object.entries(pageIds).forEach(([name, id]) => {
    const section = document.getElementById(id);
    if (section) section.hidden = name !== pageName;
  });

  $$("[data-page]").forEach((button) => {
    const active = button.dataset.page === pageName;
    button.classList.toggle("active", active);
    button.setAttribute("aria-current", active ? "page" : "false");
  });

  const headings = {
    dashboard: "오늘의 계획",
    goals: "나의 목표",
    schedule: "일정 관리",
  };

  const heading = $("#page-heading");
  if (heading) heading.textContent = headings[pageName];

  renderAll();
}

function isGoalActiveToday(goal) {
  const today = localDateString();
  return goal.startDate <= today && goal.endDate >= today;
}

function getGoalProgress(goalId) {
  const tasks = getGoalTasks(goalId);
  if (!tasks.length) return 0;

  const completed = tasks.filter((task) => task.done).length;
  return Math.round((completed / tasks.length) * 100);
}

function getFrequencyLabel(goal) {
  if (goal.frequency === "daily") return "매일";
  if (goal.frequency === "weekdays") return "평일";
  if (goal.frequency === "custom") {
    const days = (goal.weekdays || [])
      .slice()
      .sort((a, b) => a - b)
      .map((day) => WEEKDAY_NAMES[day])
      .join(", ");
    return days ? `${days}요일` : "선택 요일";
  }
  return "반복";
}

function renderHeader() {
  const dateElement = $("#header-date");
  if (dateElement) {
    dateElement.textContent = formatDate(localDateString(), {
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "long",
    });
  }

  const scheduleDate = $("#schedule-date");
  if (scheduleDate && !scheduleDate.value) {
    scheduleDate.value = localDateString();
  }
}

function renderMetrics() {
  const todayTasks = getTodayTasks();
  const completedToday = todayTasks.filter((task) => task.done).length;
  const activeGoals = state.goals.filter(isGoalActiveToday);

  const goalsMetric = $("#metric-goals");
  const tasksMetric = $("#metric-tasks");
  const doneMetric = $("#metric-done");

  if (goalsMetric) goalsMetric.textContent = String(activeGoals.length);
  if (tasksMetric) tasksMetric.textContent = String(todayTasks.length);
  if (doneMetric) {
    doneMetric.textContent = todayTasks.length
      ? `${Math.round((completedToday / todayTasks.length) * 100)}%`
      : "0%";
  }
}

function renderTaskRow(task) {
  const goal = getGoal(task.goalId);
  const timeLabel = task.startTime
    ? `${escapeHTML(task.startTime)} · ${Number(task.duration) || 30}분`
    : `${Number(task.duration) || 30}분`;

  return `
    <article class="task-row ${task.done ? "completed" : ""}">
      <button
        class="task-check"
        type="button"
        data-toggle-task="${escapeHTML(task.id)}"
        aria-label="${task.done ? "완료 취소" : "완료 표시"}: ${escapeHTML(task.title)}"
        aria-pressed="${task.done ? "true" : "false"}"
      >${task.done ? "✓" : ""}</button>

      <div class="task-content">
        <div class="task-title">${escapeHTML(task.title)}</div>
        <div class="task-meta">
          ${timeLabel}
          ${goal ? ` · ${escapeHTML(goal.name)}` : ""}
        </div>
        ${task.notes ? `<div class="task-notes">${escapeHTML(task.notes)}</div>` : ""}
      </div>

      <div class="task-actions">
        <button type="button" class="icon-button" data-start-task="${escapeHTML(task.id)}" aria-label="지금 시작하기">▶</button>
        <button type="button" class="icon-button" data-edit-task="${escapeHTML(task.id)}" aria-label="일정 수정">✎</button>
        <button type="button" class="icon-button" data-delete-task="${escapeHTML(task.id)}" aria-label="일정 삭제">×</button>
      </div>
    </article>
  `;
}

function renderTodayList() {
  const container = $("#today-list");
  if (!container) return;

  const tasks = getTodayTasks();

  if (!tasks.length) {
    container.innerHTML = `
      <div class="empty-state">
        <p>오늘의 일정이 아직 없습니다.</p>
        <p>작은 일정 하나부터 시작해 보세요.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = tasks.map(renderTaskRow).join("");
}

function renderNextAction() {
  const container = $("#next-action");
  if (!container) return;

  const task = getTodayTasks().find((item) => !item.done);

  if (!task) {
    container.innerHTML = `
      <div class="action-card">
        <div>
          <p class="eyebrow">NEXT ACTION</p>
          <h3>지금 할 일이 있나요?</h3>
          <p>작은 행동 하나를 계획하고 시작해 보세요.</p>
        </div>
        <button class="primary-button" type="button" data-new-task>일정 추가</button>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="action-card">
      <div>
        <p class="eyebrow">NEXT ACTION</p>
        <h3>${escapeHTML(task.title)}</h3>
        <p>${task.startTime ? `${escapeHTML(task.startTime)} 시작 · ` : ""}${Number(task.duration) || 30}분 집중</p>
      </div>
      <button class="primary-button" type="button" data-start-task="${escapeHTML(task.id)}">지금 시작하기</button>
    </div>
  `;
}

function renderGoalPreview() {
  const container = $("#goal-preview");
  if (!container) return;

  const goals = state.goals
    .filter((goal) => goal.endDate >= localDateString())
    .slice(0, 3);

  if (!goals.length) {
    container.innerHTML = `
      <div class="empty-state">
        <p>등록된 목표가 없습니다.</p>
        <button type="button" class="primary-button" data-new-goal>첫 목표 만들기</button>
      </div>
    `;
    return;
  }

  container.innerHTML = goals.map((goal) => {
    const progress = getGoalProgress(goal.id);

    return `
      <article class="goal-preview-item">
        <div class="goal-preview-top">
          <strong>${escapeHTML(goal.name)}</strong>
          <span>${progress}%</span>
        </div>
        <div class="progress-track">
          <div class="progress-fill" style="width:${progress}%"></div>
        </div>
        <p>${escapeHTML(CATEGORY_NAMES[goal.category] || "개인")} · ${escapeHTML(getFrequencyLabel(goal))}</p>
      </article>
    `;
  }).join("");
}

function renderGoals() {
  const container = $("#goals-list");
  if (!container) return;

  const goals = state.goals.slice().sort((a, b) =>
    a.startDate.localeCompare(b.startDate)
  );

  if (!goals.length) {
    container.innerHTML = `
      <div class="empty-state">
        <p>아직 목표가 없습니다.</p>
        <p>목표를 만들면 반복 일정이 자동으로 생성됩니다.</p>
        <button type="button" class="primary-button" data-new-goal>목표 만들기</button>
      </div>
    `;
    return;
  }

  container.innerHTML = goals.map((goal) => {
    const progress = getGoalProgress(goal.id);
    const taskCount = getGoalTasks(goal.id).length;
    const doneCount = getGoalTasks(goal.id).filter((task) => task.done).length;

    return `
      <article class="goal-card">
        <div class="goal-card-header">
          <div>
            <span class="tag">${escapeHTML(CATEGORY_NAMES[goal.category] || "개인")}</span>
            <h3>${escapeHTML(goal.name)}</h3>
          </div>
          <div class="task-actions">
            <button type="button" class="icon-button" data-edit-goal="${escapeHTML(goal.id)}" aria-label="목표 수정">✎</button>
            <button type="button" class="icon-button" data-delete-goal="${escapeHTML(goal.id)}" aria-label="목표 삭제">×</button>
          </div>
        </div>

        ${goal.description ? `<p>${escapeHTML(goal.description)}</p>` : ""}

        <div class="goal-date-range">
          ${formatDate(goal.startDate, { month: "short", day: "numeric" })}
          – ${formatDate(goal.endDate, { month: "short", day: "numeric", year: "numeric" })}
        </div>

        <div class="goal-progress-label">
          <span>진행률</span>
          <strong>${progress}%</strong>
        </div>

        <div class="progress-track">
          <div class="progress-fill" style="width:${progress}%"></div>
        </div>

        <p class="goal-footnote">
          ${escapeHTML(getFrequencyLabel(goal))} · ${doneCount}/${taskCount}개 완료
        </p>
      </article>
    `;
  }).join("");
}

function renderSchedule() {
  const container = $("#schedule-list");
  if (!container) return;

  const dateInput = $("#schedule-date");
  const selectedDate = dateInput?.value || localDateString();

  const tasks = state.tasks
    .filter((task) => task.date === selectedDate)
    .sort((a, b) => (a.startTime || "23:59").localeCompare(b.startTime || "23:59"));

  if (!tasks.length) {
    container.innerHTML = `
      <div class="empty-state">
        <p>${escapeHTML(formatDate(selectedDate, {
          month: "long",
          day: "numeric",
          weekday: "long",
        }))} 일정이 없습니다.</p>
        <button type="button" class="primary-button" data-new-task>일정 추가</button>
      </div>
    `;
    return;
  }

  container.innerHTML = tasks.map(renderTaskRow).join("");
}

function renderAll() {
  renderHeader();
  renderMetrics();
  renderTodayList();
  renderNextAction();
  renderGoalPreview();
  renderGoals();
  renderSchedule();
  updateTaskGoalOptions();
}

function generateGoalTasks(goal) {
  const previousTasks = state.tasks.filter((task) => task.goalId === goal.id);
  const oldTaskMap = new Map(
    previousTasks.map((task) => [
      `${task.date}|${task.startTime || ""}|${task.title}`,
      task,
    ])
  );

  const generated = [];
  let cursor = goal.startDate;
  let safety = 0;

  while (cursor <= goal.endDate && safety < 2000) {
    safety += 1;

    const weekday = new Date(`${cursor}T12:00:00`).getDay();
    let shouldCreate = false;

    if (goal.frequency === "daily") {
      shouldCreate = true;
    } else if (goal.frequency === "weekdays") {
      shouldCreate = weekday >= 1 && weekday <= 5;
    } else if (goal.frequency === "custom") {
      shouldCreate = (goal.weekdays || []).includes(weekday);
    }

    if (shouldCreate) {
      const title = goal.name;
      const key = `${cursor}|${goal.time || ""}|${title}`;
      const oldTask = oldTaskMap.get(key);

      generated.push({
        id: oldTask?.id || makeId(),
        goalId: goal.id,
        title,
        date: cursor,
        startTime: goal.time || "",
        duration: Number(goal.duration) || 30,
        notes: goal.description || "",
        done: oldTask?.done || false,
        started: oldTask?.started || false,
        firstAction: oldTask?.firstAction || "",
        source: "goal",
      });
    }

    cursor = shiftDate(cursor, 1);
  }

  state.tasks = state.tasks.filter((task) => task.goalId !== goal.id);
  state.tasks.push(...generated);
}

function updateTaskGoalOptions() {
  const select = $("#task-goal");
  if (!select) return;

  const previousValue = select.value;

  select.innerHTML = `<option value="">연결할 목표 없음</option>` +
    state.goals.map((goal) =>
      `<option value="${escapeHTML(goal.id)}">${escapeHTML(goal.name)}</option>`
    ).join("");

  if (previousValue && getGoal(previousValue)) {
    select.value = previousValue;
  }
}

function resetGoalForm() {
  const form = $("#goal-form");
  if (form) form.reset();

  editingGoalId = null;

  const title = $("#goal-modal-title");
  if (title) title.textContent = "새 목표 만들기";

  const start = $("#goal-start");
  const end = $("#goal-end");

  if (start) start.value = localDateString();
  if (end) end.value = shiftDate(localDateString(), 6);

  const duration = $("#goal-duration");
  if (duration) duration.value = "30";

  const time = $("#goal-time");
  if (time) time.value = "09:00";

  const frequency = $("#goal-frequency");
  if (frequency) frequency.value = "daily";

  const error = $("#goal-error");
  if (error) error.textContent = "";
}

function openGoalForm(goalId = null) {
  resetGoalForm();

  if (goalId) {
    const goal = getGoal(goalId);
    if (!goal) return;

    editingGoalId = goal.id;

    $("#goal-name").value = goal.name;
    $("#goal-description").value = goal.description || "";
    $("#goal-start").value = goal.startDate;
    $("#goal-end").value = goal.endDate;
    $("#goal-frequency").value = goal.frequency;
    $("#goal-duration").value = String(goal.duration || 30);
    $("#goal-time").value = goal.time || "";
    $("#goal-category").value = goal.category || "personal";

    $$("#weekday-picker input").forEach((checkbox) => {
      checkbox.checked = (goal.weekdays || []).includes(Number(checkbox.value));
    });

    const title = $("#goal-modal-title");
    if (title) title.textContent = "목표 수정";
  }

  openDialog("goal-dialog");
}

function handleGoalSubmit(event) {
  event.preventDefault();

  const name = $("#goal-name").value.trim();
  const description = $("#goal-description").value.trim();
  const startDate = $("#goal-start").value;
  const endDate = $("#goal-end").value;
  const frequency = $("#goal-frequency").value;
  const duration = Number($("#goal-duration").value) || 30;
  const time = $("#goal-time").value;
  const category = $("#goal-category").value;
  const weekdays = $$("#weekday-picker input:checked")
    .map((checkbox) => Number(checkbox.value));

  const error = $("#goal-error");
  if (error) error.textContent = "";

  if (!name || !startDate || !endDate) {
    if (error) error.textContent = "목표 이름과 시작일, 종료일을 입력해 주세요.";
    return;
  }

  if (endDate < startDate) {
    if (error) error.textContent = "종료일은 시작일보다 빠를 수 없습니다.";
    return;
  }

  if (frequency === "custom" && weekdays.length === 0) {
    if (error) error.textContent = "반복할 요일을 하나 이상 선택해 주세요.";
    return;
  }

  const existing = editingGoalId ? getGoal(editingGoalId) : null;

  const goal = {
    id: editingGoalId || makeId(),
    name,
    description,
    startDate,
    endDate,
    frequency,
    duration,
    time,
    category,
    weekdays,
    createdAt: existing?.createdAt || new Date().toISOString(),
  };

  if (existing) {
    state.goals = state.goals.map((item) =>
      item.id === existing.id ? goal : item
    );
  } else {
    state.goals.push(goal);
  }

  generateGoalTasks(goal);
  saveData();
  closeDialog("goal-dialog");
  renderAll();
  showToast(existing ? "목표를 수정했습니다." : "목표와 반복 일정을 만들었습니다.");
}

function deleteGoal(goalId) {
  const goal = getGoal(goalId);
  if (!goal) return;

  const confirmed = window.confirm(
    `"${goal.name}" 목표와 연결된 자동 일정을 삭제할까요?`
  );
  if (!confirmed) return;

  state.goals = state.goals.filter((item) => item.id !== goalId);
  state.tasks = state.tasks.filter((task) => task.goalId !== goalId);

  saveData();
  renderAll();
  showToast("목표를 삭제했습니다.");
}

function resetTaskForm() {
  const form = $("#task-form");
  if (form) form.reset();

  editingTaskId = null;

  const title = $("#task-modal-title");
  if (title) title.textContent = "새 일정 추가";

  const date = $("#task-date");
  if (date) date.value = $("#schedule-date")?.value || localDateString();

  const duration = $("#task-minutes");
  if (duration) duration.value = "30";

  const start = $("#task-start");
  if (start) start.value = "";

  const error = $("#task-error");
  if (error) error.textContent = "";

  updateTaskGoalOptions();
}

function openTaskForm(taskId = null) {
  resetTaskForm();

  if (taskId) {
    const task = getTask(taskId);
    if (!task) return;

    editingTaskId = task.id;

    $("#task-name").value = task.title;
    $("#task-date").value = task.date;
    $("#task-goal").value = task.goalId || "";
    $("#task-start").value = task.startTime || "";
    $("#task-minutes").value = String(task.duration || 30);
    $("#task-notes").value = task.notes || "";

    const title = $("#task-modal-title");
    if (title) title.textContent = "일정 수정";
  }

  openDialog("task-dialog");
}

function handleTaskSubmit(event) {
  event.preventDefault();

  const title = $("#task-name").value.trim();
  const date = $("#task-date").value;
  const goalId = $("#task-goal").value;
  const startTime = $("#task-start").value;
  const duration = Number($("#task-minutes").value) || 30;
  const notes = $("#task-notes").value.trim();

  const error = $("#task-error");
  if (error) error.textContent = "";

  if (!title || !date) {
    if (error) error.textContent = "일정 이름과 날짜를 입력해 주세요.";
    return;
  }

  const existing = editingTaskId ? getTask(editingTaskId) : null;

  const task = {
    id: editingTaskId || makeId(),
    goalId: goalId || null,
    title,
    date,
    startTime,
    duration,
    notes,
    done: existing?.done || false,
    started: existing?.started || false,
    firstAction: existing?.firstAction || "",
    source: "manual",
  };

  if (existing) {
    state.tasks = state.tasks.map((item) =>
      item.id === existing.id ? task : item
    );
  } else {
    state.tasks.push(task);
  }

  saveData();
  closeDialog("task-dialog");
  renderAll();
  showToast(existing ? "일정을 수정했습니다." : "일정을 추가했습니다.");
}

function toggleTask(taskId) {
  const task = getTask(taskId);
  if (!task) return;

  task.done = !task.done;
  saveData();
  renderAll();
  showToast(task.done ? "좋아요! 한 걸음 나아갔어요." : "완료 상태를 취소했습니다.");
}

function deleteTask(taskId) {
  const task = getTask(taskId);
  if (!task) return;

  if (!window.confirm(`"${task.title}" 일정을 삭제할까요?`)) return;

  state.tasks = state.tasks.filter((item) => item.id !== taskId);
  saveData();
  renderAll();
  showToast("일정을 삭제했습니다.");
}

function openAction(taskId) {
  const task = getTask(taskId);
  if (!task) return;

  activeTaskId = taskId;

  const title = $("#action-title");
  const context = $("#action-context");
  const step = $("#action-step");

  if (title) title.textContent = task.title;
  if (context) {
    const goal = getGoal(task.goalId);
    context.textContent = goal
      ? `${goal.name} 목표를 위한 작은 행동부터 시작해 보세요.`
      : "완벽하게 하려고 하기보다, 작은 행동 하나부터 시작해 보세요.";
  }

  if (step) {
    step.value = task.firstAction || "";
    step.placeholder = "예: 자료를 열고 첫 문장 읽기";
  }

  stopTimer();
  timerSeconds = 300;
  timerRunning = false;
  updateTimerDisplay();

  const toggle = $("#timer-toggle");
  if (toggle) toggle.textContent = "집중 시작";

  openDialog("action-dialog");
}

function updateTimerDisplay() {
  const display = $("#timer-display");
  if (!display) return;

  const minutes = Math.floor(timerSeconds / 60);
  const seconds = timerSeconds % 60;

  display.textContent =
    `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  timerRunning = false;
}

function startTimer() {
  if (timerRunning) {
    stopTimer();
    const toggle = $("#timer-toggle");
    if (toggle) toggle.textContent = "다시 시작";
    return;
  }

  if (timerSeconds <= 0) timerSeconds = 300;

  timerRunning = true;
  const toggle = $("#timer-toggle");
  if (toggle) toggle.textContent = "일시 정지";

  timerInterval = setInterval(() => {
    timerSeconds -= 1;
    updateTimerDisplay();

    if (timerSeconds <= 0) {
      stopTimer();
      timerSeconds = 0;
      updateTimerDisplay();

      const button = $("#timer-toggle");
      if (button) button.textContent = "다시 시작";

      showToast("집중 시간 완료! 잠깐 쉬어도 좋아요.");
    }
  }, 1000);
}

function saveAction() {
  const task = getTask(activeTaskId);
  if (!task) {
    closeDialog("action-dialog");
    return;
  }

  const step = $("#action-step");
  task.firstAction = step ? step.value.trim() : "";
  task.started = true;

  saveData();
  renderAll();
  stopTimer();
  closeDialog("action-dialog");
  showToast("작은 행동을 기록했습니다. 이제 시작해 보세요!");
}

function bindEvents() {
  $$("[data-page]").forEach((button) => {
    button.addEventListener("click", () => setPage(button.dataset.page));
  });

  $$("[data-goto]").forEach((button) => {
    button.addEventListener("click", () => setPage(button.dataset.goto));
  });

  $("#new-goal-top")?.addEventListener("click", () => openGoalForm());
  $("#new-goal-bottom")?.addEventListener("click", () => openGoalForm());
  $("#new-goal-page")?.addEventListener("click", () => openGoalForm());

  $("#new-task-short")?.addEventListener("click", () => openTaskForm());
  $("#new-task-page")?.addEventListener("click", () => openTaskForm());

  $("#goal-form")?.addEventListener("submit", handleGoalSubmit);
  $("#task-form")?.addEventListener("submit", handleTaskSubmit);
  $("#action-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    saveAction();
  });

  $$("[data-close]").forEach((button) => {
    button.addEventListener("click", () => closeDialog(button.dataset.close));
  });

  ["goal-dialog", "task-dialog", "action-dialog"].forEach((id) => {
    const dialog = document.getElementById(id);
    if (!dialog) return;

    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
  });

  $("#schedule-date")?.addEventListener("change", renderSchedule);

  $("#timer-toggle")?.addEventListener("click", startTimer);

  document.addEventListener("click", (event) => {
    const target = event.target.closest("button");
    if (!target) return;

    if (target.hasAttribute("data-new-goal")) {
      openGoalForm();
      return;
    }

    if (target.hasAttribute("data-new-task")) {
      openTaskForm();
      return;
    }

    if (target.dataset.toggleTask) {
      toggleTask(target.dataset.toggleTask);
      return;
    }

    if (target.dataset.startTask) {
      openAction(target.dataset.startTask);
      return;
    }

    if (target.dataset.editGoal) {
      openGoalForm(target.dataset.editGoal);
      return;
    }

    if (target.dataset.deleteGoal) {
      deleteGoal(target.dataset.deleteGoal);
      return;
    }

    if (target.dataset.editTask) {
      openTaskForm(target.dataset.editTask);
      return;
    }

    if (target.dataset.deleteTask) {
      deleteTask(target.dataset.deleteTask);
    }
  });

  document.addEventListener("visibilitychange", () => {
    // Prevent a timer from continuing unnoticed while the page is hidden.
    if (document.hidden && timerRunning) {
      stopTimer();
      const toggle = $("#timer-toggle");
      if (toggle) toggle.textContent = "다시 시작";
    }
  });
}

function initialize() {
  bindEvents();

  // Rebuild recurring tasks so that newly opened dates remain consistent.
  state.goals.forEach((goal) => generateGoalTasks(goal));

  saveData();
  renderAll();
  setPage("dashboard");
}

document.addEventListener("DOMContentLoaded", initialize);
