'use strict';

const storageKey = 'pi-remote-todo-v1';
const form = document.querySelector('#new-task-form');
const input = document.querySelector('#new-task');
const list = document.querySelector('#task-list');
const template = document.querySelector('#task-template');
const filters = document.querySelectorAll('[data-filter]');
const empty = document.querySelector('#empty-state');
const warning = document.querySelector('#storage-warning');
const saveNote = document.querySelector('#save-note');
let tasks = [];
let filter = 'all';
let canSave = true;

function readTasks(raw) {
  const saved = raw === null ? [] : JSON.parse(raw);
  if (!Array.isArray(saved) || saved.some(task => !task || typeof task.text !== 'string' ||
      !task.text.trim() || task.text.length > 300 || typeof task.done !== 'boolean')) {
    throw new Error('Invalid saved tasks');
  }
  return saved.map(({ text, done }) => ({ text, done }));
}

function storageWarning(message) {
  warning.textContent = message;
  warning.hidden = false;
  saveNote.textContent = 'Changes are only kept in this tab.';
}

try {
  tasks = readTasks(localStorage.getItem(storageKey));
} catch {
  canSave = false;
  storageWarning('Browser storage is unavailable or unreadable. New tasks will only last in this tab. Existing saved data will not be overwritten.');
}

function saveTasks() {
  if (!canSave) return;
  try {
    localStorage.setItem(storageKey, JSON.stringify(tasks));
    warning.hidden = true;
    saveNote.textContent = 'Saved in this browser. Not synced between devices.';
  } catch {
    storageWarning('Your changes could not be saved. Keep this tab open or free up browser storage.');
  }
}

function render(focusIndex, focusSelector = 'input') {
  const fragment = document.createDocumentFragment();
  tasks.forEach((task, index) => {
    if (filter === 'active' && task.done || filter === 'done' && !task.done) return;
    const row = template.content.firstElementChild.cloneNode(true);
    row.dataset.index = index;
    row.classList.toggle('is-done', task.done);
    row.querySelector('.task-text').textContent = task.text;
    const checkbox = row.querySelector('input');
    checkbox.checked = task.done;
    checkbox.addEventListener('change', () => {
      task.done = checkbox.checked;
      saveTasks();
      render(index);
    });
    const remove = row.querySelector('.delete-task');
    remove.setAttribute('aria-label', 'Delete ' + task.text);
    remove.addEventListener('click', () => {
      tasks.splice(index, 1);
      saveTasks();
      render(index, '.delete-task');
    });
    fragment.append(row);
  });
  list.replaceChildren(fragment);
  list.hidden = list.children.length === 0;
  empty.hidden = !list.hidden;
  const remaining = tasks.filter(task => !task.done).length;
  document.querySelector('#remaining').textContent = `${remaining} ${remaining === 1 ? 'task' : 'tasks'} left`;
  const messages = {
    all: ['Room for your first task', 'Add something above to get started.'],
    active: ['Nothing left to do', 'Add another task, or take a break.'],
    done: ['No completed tasks yet', 'Check off a task and it will appear here.']
  };
  document.querySelector('#empty-title').textContent = messages[filter][0];
  document.querySelector('#empty-hint').textContent = messages[filter][1];
  filters.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.filter === filter)));
  if (Number.isInteger(focusIndex)) {
    const next = list.querySelector(`[data-index="${focusIndex}"] ${focusSelector}`) || list.querySelector(focusSelector);
    (next || input).focus();
  }
}

input.addEventListener('input', () => input.setCustomValidity(''));
form.addEventListener('submit', event => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text) {
    input.setCustomValidity('Enter a task first.');
    input.reportValidity();
    return;
  }
  tasks.push({ text, done: false });
  filter = 'all';
  saveTasks();
  render();
  form.reset();
  input.focus();
});
filters.forEach(button => button.addEventListener('click', () => {
  filter = button.dataset.filter;
  render();
}));

render();
