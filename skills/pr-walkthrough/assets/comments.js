/* PR Walkthrough commenting layer — runs after viewer.js has rendered the DOM.
   Authors GitHub-style line/file review comments, persists them in localStorage,
   and exports a review JSON for the post-pr-review skill. Plain DOM + storage;
   markdown-it (window.markdownit) renders comment bodies if present. */
(function () {
  'use strict'

  var dataEl = document.getElementById('walkthrough-data')
  var data
  try { data = JSON.parse(dataEl.textContent) } catch (e) { data = null }
  if (!data || !data.pr) return
  var pr = data.pr
  var md = window.markdownit ? window.markdownit({ html: false, linkify: true, breaks: true }) : null
  var KEY = 'pr-walkthrough:' + pr.repo + '#' + pr.number

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e }
  function renderBody(node, text) { if (md) { node.innerHTML = md.render(text) } else { node.textContent = text } }
  function cssEsc(s) { return String(s).replace(/["\\]/g, '\\$&') }

  // ---- store ----
  var comments = load()
  var nextId = comments.reduce(function (m, c) { return Math.max(m, c.id || 0) }, 0) + 1
  function load() { try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch (e) { return [] } }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(comments)) } catch (e) {} }
  function add(c) { c.id = nextId++; comments.push(c); save(); refresh(); return c }
  function update(id, body) { var c = byId(id); if (c) { c.body = body; save(); refresh() } }
  function remove(id) { comments = comments.filter(function (c) { return c.id !== id }); save(); refresh() }
  function byId(id) { for (var i = 0; i < comments.length; i++) if (comments[i].id === id) return comments[i]; return null }

  function readSetIds() {
    try { return JSON.parse(localStorage.getItem(KEY + ':read') || '[]') } catch (e) { return [] }
  }
  // Mirror of build-walkthrough.mjs viewedFilesFrom — keep in sync.
  function viewedFiles() {
    var ph = data.pathHunks || {}
    var read = {}; readSetIds().forEach(function (id) { read[id] = true })
    return Object.keys(ph).filter(function (p) {
      var h = ph[p]
      return h.fullyCovered && h.hunkIds.length > 0 && h.hunkIds.every(function (id) { return read[id] })
    })
  }
  function exportReview() {
    var out = { repo: pr.repo, pr: pr.number, commit: pr.commit, body: '', comments: [], fileComments: [], viewedFiles: viewedFiles() }
    comments.forEach(function (c) {
      if (c.kind === 'file') { out.fileComments.push({ path: c.path, body: c.body }) }
      else if (!c.outdated) {
        var o = { path: c.path, side: c.side, line: c.line, body: c.body }
        if (c.startLine && c.startLine !== c.line) o.startLine = c.startLine
        out.comments.push(o)
      }
    })
    return out
  }

  // automation/test hook
  window.__wtc = { all: function () { return comments.slice() }, add: add, remove: remove, exportReview: exportReview, key: KEY }

  // ---- gutter helpers (viewer.js tags sections with data-path; gutters are td.lno/td.rno) ----
  function gutterInfo(cell) {
    if (!cell || cell.tagName !== 'TD') return null
    var left = cell.classList.contains('lno'), right = cell.classList.contains('rno')
    if (!left && !right) return null
    var n = parseInt(cell.textContent, 10)
    if (!n) return null
    var sec = cell.closest('.file')
    if (!sec) return null
    return { path: sec.getAttribute('data-path'), side: left ? 'LEFT' : 'RIGHT', line: n, cell: cell, sec: sec }
  }
  function findGutter(path, side, line) {
    var sec = document.querySelector('.file[data-path="' + cssEsc(path) + '"]')
    if (!sec) return null
    var cells = sec.querySelectorAll(side === 'LEFT' ? 'td.lno' : 'td.rno')
    for (var i = 0; i < cells.length; i++) if (parseInt(cells[i].textContent, 10) === line) return cells[i]
    return null
  }
  // gutter cells of one side within a section, in document order
  function sideCells(sec, side) { return [].slice.call(sec.querySelectorAll(side === 'LEFT' ? 'td.lno' : 'td.rno')) }

  // ---- selection (click / drag down the gutter) ----
  var drag = null
  document.addEventListener('mousedown', function (e) {
    var info = gutterInfo(e.target)
    if (!info) return
    e.preventDefault()
    closeComposer()
    drag = { side: info.side, sec: info.sec, start: info.cell, end: info.cell }
    paint()
  })
  document.addEventListener('mousemove', function (e) {
    if (!drag) return
    var info = gutterInfo(e.target)
    if (!info || info.side !== drag.side || info.sec !== drag.sec) return
    drag.end = info.cell; paint()
  })
  document.addEventListener('mouseup', function () {
    if (!drag) return
    var d = drag; drag = null
    clearPaint()
    var range = selectedCells(d)
    if (!range.length) return
    var lines = range.map(function (c) { return parseInt(c.textContent, 10) })
    var lo = Math.min.apply(null, lines), hi = Math.max.apply(null, lines)
    var anchorRow = range[range.length - 1].parentNode
    var suggestText = d.side === 'RIGHT'
      ? range.map(function (c) {
          var code = c.parentNode.querySelector('td.rc code')
          return code ? code.textContent : ''
        }).join('\n')
      : ''
    openComposer(anchorRow, { kind: 'line', path: d.sec.getAttribute('data-path'), side: d.side, line: hi, startLine: lo === hi ? null : lo, suggestText: suggestText })
  })
  // selected cells = contiguous run between start and end on that side, clamped to one hunk (no hunksep between)
  function selectedCells(d) {
    var cells = sideCells(d.sec, d.side)
    var si = cells.indexOf(d.start), ei = cells.indexOf(d.end)
    if (si < 0 || ei < 0) return []
    if (si > ei) { var t = si; si = ei; ei = t }
    var run = []
    for (var i = si; i <= ei; i++) {
      // stop if a hunk separator sits between this row and the previous kept row
      if (run.length && crossesHunksep(run[run.length - 1].parentNode, cells[i].parentNode)) break
      run.push(cells[i])
    }
    return run
  }
  function crossesHunksep(rowA, rowB) {
    var r = rowA
    while (r && r !== rowB) { r = r.nextElementSibling; if (r && r.classList.contains('hunksep')) return true }
    return false
  }
  function paint() { clearPaint(); selectedCells(drag).forEach(function (c) { c.parentNode.classList.add('wt-selecting') }) }
  function clearPaint() { [].slice.call(document.querySelectorAll('.wt-selecting')).forEach(function (r) { r.classList.remove('wt-selecting') }) }

  // ---- composer ----
  var composerRow = null
  function closeComposer() { if (composerRow) { composerRow.remove(); composerRow = null } }

  function buildComposer(opts) {
    opts = opts || {}
    var root = el('div', 'wt-composer')
    var bar = el('div', 'wt-bar')
    var tabs = el('div', 'wt-tabs')
    var tabW = el('span', 'wt-tab wt-on', 'Write'), tabP = el('span', 'wt-tab', 'Preview')
    tabs.appendChild(tabW); tabs.appendChild(tabP); bar.appendChild(tabs)

    var ta = el('textarea'); ta.placeholder = opts.placeholder || 'Comment…'
    var preview = el('div', 'wt-preview prose'); preview.style.display = 'none'

    function wrap(before, after, sample) {
      var s = ta.selectionStart, e = ta.selectionEnd, v = ta.value
      var sel = v.slice(s, e) || sample || ''
      ta.value = v.slice(0, s) + before + sel + after + v.slice(e)
      ta.focus(); ta.selectionStart = s + before.length; ta.selectionEnd = s + before.length + sel.length
    }
    var TOOLS = [
      ['B', 'Bold', function () { wrap('**', '**', 'bold') }],
      ['i', 'Italic', function () { wrap('_', '_', 'italic') }],
      ['</>', 'Code', function () { wrap('`', '`', 'code') }],
      ['▤', 'Code block', function () { wrap('\n```\n', '\n```\n', 'code') }],
      ['🔗', 'Link', function () { wrap('[', '](url)', 'text') }],
      ['❝', 'Quote', function () { wrap('> ', '', 'quote') }],
      ['☰', 'List', function () { wrap('- ', '', 'item') }],
    ]
    TOOLS.forEach(function (t) {
      var b = el('button', 'wt-tbtn', t[0]); b.type = 'button'; b.title = t[1]
      b.addEventListener('click', function () { tabW.click(); t[2]() })
      bar.appendChild(b)
    })
    if (opts.suggestText) {
      var sg = el('button', 'wt-tbtn wt-suggest', '± Suggest'); sg.type = 'button'; sg.title = 'Insert a suggestion prefilled with the selected lines'
      sg.addEventListener('click', function () {
        tabW.click()
        var pre = ta.value && ta.value.slice(-1) !== '\n' ? ta.value + '\n' : ta.value
        ta.value = pre + '```suggestion\n' + opts.suggestText + '\n```\n'
        ta.focus()
      })
      bar.appendChild(sg)
    }
    tabW.addEventListener('click', function () { root.classList.remove('wt-previewing'); tabW.classList.add('wt-on'); tabP.classList.remove('wt-on'); ta.style.display = ''; preview.style.display = 'none' })
    tabP.addEventListener('click', function () { root.classList.add('wt-previewing'); tabP.classList.add('wt-on'); tabW.classList.remove('wt-on'); renderBody(preview, ta.value || '_Nothing to preview_'); ta.style.display = 'none'; preview.style.display = '' })

    root.appendChild(bar); root.appendChild(ta); root.appendChild(preview)
    return { root: root, getValue: function () { return ta.value.trim() }, focus: function () { ta.focus() } }
  }

  function openComposer(afterRow, anchor) {
    closeComposer()
    var tr = el('tr', 'wt-composer-row')
    var td = el('td'); td.colSpan = 4
    var c = buildComposer({ placeholder: 'Comment…', suggestText: anchor.suggestText })
    var row = el('div', 'wt-actions')
    var cancel = el('button', 'wt-btn', 'Cancel'); var ok = el('button', 'wt-btn wt-primary', 'Add to review')
    cancel.addEventListener('click', closeComposer)
    ok.addEventListener('click', function () {
      var body = c.getValue(); if (!body) return
      add({ kind: anchor.kind, path: anchor.path, side: anchor.side, line: anchor.line, startLine: anchor.startLine, body: body })
      closeComposer()
    })
    row.appendChild(cancel); row.appendChild(ok)
    c.root.appendChild(row); td.appendChild(c.root); tr.appendChild(td)
    afterRow.parentNode.insertBefore(tr, afterRow.nextSibling)
    composerRow = tr; c.focus()
  }

  // ---- file-level "comment on file" buttons ----
  function wireFileButtons() {
    [].slice.call(document.querySelectorAll('.file')).forEach(function (sec) {
      var head = sec.querySelector('.file-head'); if (!head || head.querySelector('.wt-file-btn')) return
      var btn = el('button', 'wt-file-btn', '💬 Comment on file')
      btn.addEventListener('click', function (e) {
        e.stopPropagation()  // don't toggle the section collapse
        var body = sec.querySelector('.file-body') || sec
        // open a composer at the top of the file body via a lightweight block (not a table row)
        openBlockComposer(body, { kind: 'file', path: sec.getAttribute('data-path') })
      })
      head.appendChild(btn)
    })
  }
  var blockComposer = null
  function openBlockComposer(container, anchor) {
    if (blockComposer) { blockComposer.remove(); blockComposer = null }
    var c = buildComposer({ placeholder: 'Comment on this file…' })
    c.root.classList.add('wt-block')
    var row = el('div', 'wt-actions')
    var cancel = el('button', 'wt-btn', 'Cancel'); var ok = el('button', 'wt-btn wt-primary', 'Add to review')
    cancel.addEventListener('click', function () { c.root.remove(); blockComposer = null })
    ok.addEventListener('click', function () { var b = c.getValue(); if (!b) return; add({ kind: 'file', path: anchor.path, body: b }); c.root.remove(); blockComposer = null })
    row.appendChild(cancel); row.appendChild(ok); c.root.appendChild(row)
    container.insertBefore(c.root, container.firstChild); blockComposer = c.root; c.focus()
  }

  // ---- render threads, markers, file-comment cards ----
  function clearRendered() {
    [].slice.call(document.querySelectorAll('.wt-thread-row, .wt-file-card, .wt-marker')).forEach(function (n) { n.remove() })
    ;[].slice.call(document.querySelectorAll('.wt-has-comment')).forEach(function (c) { c.classList.remove('wt-has-comment') })
  }
  function threadCard(c) {
    var card = el('div', 'wt-thread')
    var h = el('div', 'wt-thread-h')
    h.appendChild(el('b', null, 'You'))
    h.appendChild(document.createTextNode(c.kind === 'file' ? ' · on file' + (c.outdated ? '' : '') : ' · ' + (c.side === 'RIGHT' ? '+' : '-') + (c.startLine && c.startLine !== c.line ? c.startLine + '–' + c.line : c.line)))
    var acts = el('span', 'wt-acts')
    var edit = el('button', 'wt-link', 'edit'); var del = el('button', 'wt-link', 'delete')
    edit.addEventListener('click', function () {        // edit in place (works for both tr-embedded and div cards)
      var ta = el('textarea'); ta.value = c.body
      var actions = el('div', 'wt-actions')
      var cancel = el('button', 'wt-btn', 'Cancel'); var ok = el('button', 'wt-btn wt-primary', 'Save')
      cancel.addEventListener('click', refresh)
      ok.addEventListener('click', function () { var b = ta.value.trim(); if (b) update(c.id, b); else refresh() })
      actions.appendChild(cancel); actions.appendChild(ok)
      card.textContent = ''; card.appendChild(ta); card.appendChild(actions); ta.focus()
    })
    del.addEventListener('click', function () { remove(c.id) })
    acts.appendChild(edit); acts.appendChild(del); h.appendChild(acts)
    var body = el('div', 'wt-thread-b'); renderBody(body, c.body)
    card.appendChild(h); card.appendChild(body)
    return card
  }
  function renderLineThreads() {
    comments.filter(function (c) { return c.kind === 'line' }).forEach(function (c) {
      var cell = findGutter(c.path, c.side, c.line)
      if (!cell) { c.outdated = true; return }   // anchor line gone after regeneration
      c.outdated = false
      cell.classList.add('wt-has-comment')
      var marker = el('span', 'wt-marker', '💬'); cell.appendChild(marker)
      var row = cell.parentNode
      var tr = el('tr', 'wt-thread-row'); var td = el('td'); td.colSpan = 4
      td.appendChild(threadCard(c)); tr.appendChild(td)
      row.parentNode.insertBefore(tr, row.nextSibling)
    })
  }
  function renderFileCards() {
    comments.filter(function (c) { return c.kind === 'file' }).forEach(function (c) {
      var sec = document.querySelector('.file[data-path="' + cssEsc(c.path) + '"]'); if (!sec) return
      var body = sec.querySelector('.file-body') || sec
      var card = threadCard(c); card.classList.add('wt-file-card')
      body.insertBefore(card, body.firstChild)
    })
  }

  // ---- review panel ----
  var panel = null
  var PANEL_KEY = KEY + ':panel-collapsed'
  var panelCollapsed = false
  try { panelCollapsed = localStorage.getItem(PANEL_KEY) === '1' } catch (e) {}

  function scrollToComment(c) {
    var target
    if (c.kind === 'file') { target = document.querySelector('.file[data-path="' + cssEsc(c.path) + '"]') }
    else { target = findGutter(c.path, c.side, c.line) || document.querySelector('.file[data-path="' + cssEsc(c.path) + '"]') }
    if (!target) return
    var sec = target.closest && target.closest('.file')
    if (sec && sec.classList.contains('collapsed')) sec.classList.remove('collapsed')   // expand so it's visible
    target.scrollIntoView({ behavior: 'smooth', block: 'center' })
    target.classList.add('wt-flash'); setTimeout(function () { target.classList.remove('wt-flash') }, 1200)
  }

  function renderPanel() {
    if (!panel) { panel = el('div', 'wt-panel'); document.body.appendChild(panel) }
    panel.textContent = ''
    panel.classList.toggle('wt-collapsed', panelCollapsed)

    var head = el('div', 'wt-panel-h')
    head.appendChild(el('span', 'wt-caret', panelCollapsed ? '▸' : '▾'))
    head.appendChild(el('span', null, ' 📝 Review'))
    head.appendChild(el('span', 'wt-count', comments.length + (comments.length === 1 ? ' comment' : ' comments')))
    head.addEventListener('click', function () {
      panelCollapsed = !panelCollapsed
      try { localStorage.setItem(PANEL_KEY, panelCollapsed ? '1' : '0') } catch (e) {}
      renderPanel()
    })
    panel.appendChild(head)

    var list = el('div', 'wt-panel-list')
    comments.forEach(function (c) {
      var it = el('div', 'wt-panel-it')
      var loc = c.kind === 'file' ? c.path + ' (file)' : c.path + ' ' + (c.side === 'RIGHT' ? '+' : '-') + c.line + (c.outdated ? ' (outdated)' : '')
      it.appendChild(el('span', 'wt-loc' + (c.outdated ? ' wt-outdated' : ''), loc))
      it.appendChild(el('span', 'wt-snip', ' · ' + c.body.slice(0, 50)))
      it.title = 'Jump to comment'
      it.addEventListener('click', function () { scrollToComment(c) })
      list.appendChild(it)
    })
    panel.appendChild(list)

    var foot = el('div', 'wt-panel-f')
    var clear = el('button', 'wt-btn', 'Clear')
    var copy = el('button', 'wt-btn wt-primary', 'Copy review')
    copy.disabled = comments.length === 0; clear.disabled = comments.length === 0
    clear.addEventListener('click', function () { if (confirm('Delete all ' + comments.length + ' comments?')) { comments = []; save(); refresh() } })
    copy.addEventListener('click', function () {
      var text = JSON.stringify(exportReview(), null, 2)
      var flash = function (msg, ms) { copy.textContent = msg; setTimeout(function () { copy.textContent = 'Copy review' }, ms) }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { flash('Copied!', 1200) }).catch(function () { flash('Copy failed', 1500) })
      } else {
        flash('Copy unavailable', 1500)   // no clipboard API (rare; older/file:// contexts)
      }
    })
    foot.appendChild(clear); foot.appendChild(copy); panel.appendChild(foot)
  }

  function updateSidebarBadges() {
    var counts = {}
    comments.forEach(function (c) { if (!c.outdated) counts[c.path] = (counts[c.path] || 0) + 1 })
    ;[].slice.call(document.querySelectorAll('.sidebar .file-link')).forEach(function (link) {
      var badge = link.querySelector('.badge'); if (!badge) return
      var n = counts[link.getAttribute('data-path')] || 0
      badge.textContent = n ? '💬' + n : ''
    })
  }

  // ---- refresh everything from the store ----
  function refresh() { clearRendered(); renderLineThreads(); renderFileCards(); renderPanel(); updateSidebarBadges() }

  wireFileButtons()
  refresh()
})()
