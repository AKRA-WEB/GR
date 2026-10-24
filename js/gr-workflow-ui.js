(function (root) {
  'use strict';
  function responsiveTable(bodyId, labels) {
    const body = document.getElementById(bodyId);
    const table = body?.closest('table');
    if (!table) return;
    table.classList.add('gr-responsive-table');
    table.setAttribute('role', 'table');
    table.parentElement.classList.add('gr-responsive-table-wrap');
    table.querySelectorAll('thead, tbody').forEach(group => group.setAttribute('role', 'rowgroup'));
    table.querySelectorAll('tr').forEach(row => row.setAttribute('role', 'row'));
    table.querySelectorAll('th').forEach(header => header.setAttribute('role', 'columnheader'));
    body.querySelectorAll('tr').forEach(row => {
      Array.from(row.children).forEach((cell, index) => {
        cell.setAttribute('role', 'cell');
        if (cell.colSpan === 1) cell.dataset.label = labels[index] || '';
      });
    });
  }
  function navigation(viewId) {
    const active = viewId === 'delivery-plan-view' ? '.gr-nav-planning' : viewId === 'vendor-leadtime-view' ? '.gr-nav-vendor' : '.gr-nav-receiving';
    document.querySelectorAll('.gr-sidebar__menu button').forEach(button => {
      if (button.matches(active)) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
  }
  function filterSummary() {
    const summary = document.getElementById('gr-report-filter-summary');
    if (!summary) return;
    const labels = ['dashboard-date-preset', 'dashboard-bill-wh', 'dashboard-bill-receiver', 'dashboard-bill-issue'].map(id => {
      const field = document.getElementById(id);
      return field?.selectedOptions[0]?.textContent || '';
    });
    const query = document.getElementById('dashboard-bill-search')?.value.trim();
    if (query) labels.push(`ค้นหา: ${query}`);
    summary.textContent = `· ${labels.filter(Boolean).join(' · ')}`;
  }
  document.addEventListener('DOMContentLoaded', () => {
    const disclosure = document.getElementById('gr-report-filter-disclosure');
    if (disclosure && window.matchMedia('(max-width: 767px)').matches) disclosure.open = false;
    navigation('receiving-list-view');
    filterSummary();
  });
  root.GrWorkflowUI = { responsiveTable, navigation, filterSummary };
})(window);
