import tracer from 'tracer';
export { setLevel, getLevel } from 'tracer';

export const logger = tracer.colorConsole({
  format: '{{title}} [{{timestamp}}] {{message}}',
  level: 'detail',
  methods: ['detail', 'debug', 'info', 'warn', 'error', 'silent'],
  dateformat: 'mm-dd|HH:MM:ss.L',
  preprocess: (data) => {
    data.title = data.title.toUpperCase();
    if (data.title.length < 5) {
      data.title += ' '.repeat(5 - data.title.length);
    }
  }
});
