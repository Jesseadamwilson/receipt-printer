'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { renderTemplateString } = require('../src/render-template');

test('message template places an uploaded image above the subject and body', () => {
  const template = fs.readFileSync(
    path.resolve(__dirname, '..', 'addon', 'app', 'templates', 'message.html'),
    'utf8'
  );
  const rendered = renderTemplateString(template, {
    headline: 'FROM JESSE',
    lines: ['Dinner is ready'],
    printedAt: 'Today',
    templateContext: {
      message_header: 'FROM JESSE',
      message_subject: 'Dinner',
      message_subject_hidden_class: '',
      message_image_src: '/config/receipt-printer/uploads/message_main.png',
      message_image_hidden_class: '',
      message_lines_html: '<p class="message-line">Dinner is ready</p>',
      day_of_week: 'Thursday',
      date: '8/20/2026',
      time: '5:00 PM',
      printed_at: 'Today'
    }
  });

  const imageIndex = rendered.indexOf('<figure class="message-image');
  const subjectIndex = rendered.indexOf('<h2 class="message-subject');
  const bodyIndex = rendered.indexOf('<section class="message-lines">');
  assert.ok(imageIndex >= 0 && imageIndex < subjectIndex);
  assert.ok(subjectIndex < bodyIndex);
  assert.match(rendered, /src="\/config\/receipt-printer\/uploads\/message_main\.png"/);
  assert.match(rendered, />Dinner<\/h2>/);
});
