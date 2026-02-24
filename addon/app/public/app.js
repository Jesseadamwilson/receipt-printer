const previewEl = document.getElementById('preview');
const responseEl = document.getElementById('response');

const messageForm = document.getElementById('message-form');
const agendaForm = document.getElementById('agenda-form');

document.querySelector('[data-action="preview-message"]').addEventListener('click', async () => {
  const body = buildMessageBody();
  await preview('/render/message', body);
});

document.querySelector('[data-action="print-message"]').addEventListener('click', async () => {
  const body = buildMessageBody(true);
  await submitPrint('/print/message', body);
});

document.querySelector('[data-action="preview-agenda"]').addEventListener('click', async () => {
  const body = buildAgendaBody();
  await preview('/render/daily-agenda', body);
});

document.querySelector('[data-action="print-agenda"]').addEventListener('click', async () => {
  const body = buildAgendaBody();
  await submitPrint('/print/daily-agenda', body);
});

async function preview(endpoint, payload) {
  setResponse('Rendering preview...');

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const text = await response.text();
    setResponse(text);
    return;
  }

  const blob = await response.blob();
  previewEl.src = URL.createObjectURL(blob);
  setResponse(`Preview updated from ${endpoint}`);
}

async function submitPrint(endpoint, payload) {
  setResponse('Submitting print job...');

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const text = await response.text();

  try {
    setResponse(JSON.stringify(JSON.parse(text), null, 2));
  } catch (_error) {
    setResponse(text);
  }
}

function buildMessageBody(includePrint = false) {
  const formData = new FormData(messageForm);

  const body = {
    headline: formData.get('headline'),
    message: formData.get('message'),
    footer: formData.get('footer'),
    include: {
      header: isChecked(formData, 'include_header'),
      content: isChecked(formData, 'include_content'),
      footer: isChecked(formData, 'include_footer')
    },
    theme: {
      header_size_px: numberOrUndefined(formData.get('theme_header_size_px')),
      content_size_px: numberOrUndefined(formData.get('theme_content_size_px')),
      footer_size_px: numberOrUndefined(formData.get('theme_footer_size_px'))
    }
  };

  if (includePrint) {
    body.print = {
      threshold: Number(formData.get('threshold')),
      feed_lines: Number(formData.get('feed_lines')),
      cut: isChecked(formData, 'cut')
    };
  }

  return body;
}

function buildAgendaBody() {
  const formData = new FormData(agendaForm);

  return {
    title: formData.get('title'),
    subtitle: formData.get('subtitle'),
    weather: {
      summary: formData.get('weather_summary'),
      temp: formData.get('weather_temp'),
      high: formData.get('weather_high'),
      low: formData.get('weather_low')
    },
    sleep: {
      hours: formData.get('sleep_hours')
    },
    events: parseEventLines(formData.get('events')),
    alerts: parseLines(formData.get('alerts')),
    notes: formData.get('notes'),
    include: {
      header: isChecked(formData, 'include_header'),
      weather: isChecked(formData, 'include_weather'),
      sleep: isChecked(formData, 'include_sleep'),
      events: isChecked(formData, 'include_events'),
      alerts: isChecked(formData, 'include_alerts'),
      notes: isChecked(formData, 'include_notes'),
      footer: isChecked(formData, 'include_footer')
    },
    theme: {
      header_size_px: numberOrUndefined(formData.get('theme_header_size_px')),
      content_size_px: numberOrUndefined(formData.get('theme_content_size_px')),
      footer_size_px: numberOrUndefined(formData.get('theme_footer_size_px'))
    }
  };
}

function parseEventLines(raw) {
  return parseLines(raw)
    .map((line) => {
      const [time = '', title = '', location = ''] = line.split('|').map((part) => part.trim());
      return { time, title, location };
    })
    .filter((event) => event.title);
}

function parseLines(raw) {
  return String(raw)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function isChecked(formData, key) {
  return formData.get(key) === 'on';
}

function numberOrUndefined(value) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  return Number(value);
}

function setResponse(value) {
  responseEl.textContent = value;
}
