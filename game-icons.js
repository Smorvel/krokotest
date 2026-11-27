/* Иконки комнат Кроко: хранятся отдельно от логики. */
window.KROKO_GAME_ICONS = {
  brush: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="currentColor"/></svg>`,

  soft: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
    <defs>
      <radialGradient id="softBrushGrad" cx="50%" cy="50%" r="50%">
        <stop offset="20%" stop-color="currentColor" stop-opacity="1"/>
        <stop offset="100%" stop-color="currentColor" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <circle cx="12" cy="12" r="10" fill="url(#softBrushGrad)"/>
  </svg>`,

  tablet: `<svg viewBox="-65.73 0 512 512" xmlns="http://www.w3.org/2000/svg">
    <g stroke-width="0"/>
    <g stroke-linecap="round" stroke-linejoin="round"/>
    <g data-name="08 Feather">
      <path data-name="Path 13" d="M367.479 42.622c-17.889-9.862-67.2-34.145-99.369-40.817-33.414-6.938-83.13 123.527-98.935 124.1-25.635.917-3.111-89.072 21.249-125.908C152.405 25.387 84.863 59.47 69.059 98.67c-30.552 75.756 56.622 212.086 10.114 219.93-14.5 2.442-54.663-94.019-65.085-123.449-29.463 56.312-7.28 109.029 17.08 174.893v4.09c-.934 3.562-1.742 6.97-2.583 10.438h2.583v95.574a31.858 31.858 0 1 0 63.715 0v-96.589c59.454-6.689 87.423 12.8 128.147-64.416-24.857 10.281-74.48-21.047-64.183-35.841 20.689-29.773 105.281 1.681 159.2-89.834-85.339 22.742-95.419-9.862-96.228-21.747-1.711-24.608 85.308-11.573 124.975-45.78 22.988-19.834 50.552-66.828 20.685-83.317" fill-rule="evenodd" fill="currentColor"/>
    </g>
  </svg>`,

  shapeStripe: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="19" x2="19" y2="5"/></svg>`,

  shapeSquare: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>`,

  shapeCircle: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/></svg>`,

  eraser: `<svg version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 280 280" xml:space="preserve" fill="#000000"><g stroke-width="0"></g><g stroke-linecap="round" stroke-linejoin="round"></g><g><path style="fill:#26A6D1;" d="M183.679,4.634l91.683,91.683c6.178,6.178,6.178,16.207,0,22.385L118.695,275.359 c-6.178,6.187-16.207,6.187-22.385,0L4.637,183.676c-6.178-6.178-6.178-16.198,0-22.376L161.295,4.634 C167.482-1.545,177.501-1.545,183.679,4.634z"></path><path style="fill:#E2574C;" d="M84.34,81.597L4.637,161.3c-6.178,6.178-6.178,16.198,0,22.376l91.683,91.683 c6.178,6.187,16.207,6.187,22.385,0l79.703-79.694L84.34,81.597z"></path><path style="fill:#CB4E44;" d="M40.585,125.352L4.637,161.3c-6.178,6.178-6.178,16.198,0,22.376l91.683,91.683 c6.178,6.187,16.207,6.187,22.385,0l35.949-35.94L40.585,125.352z"></path><path style="fill:#EAE5E4;" d="M20.416,145.548l114.041,114.041l-10.555,10.555L9.861,156.103L20.416,145.548z"></path></g></svg>`,

  pipette: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m2 22 1-1h3l9-9"/><path d="M3 21v-3l9-9"/><path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z"/></svg>`,

  smooth: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 18C4 10 10 6 20 6"/><circle cx="4" cy="18" r="2"/><circle cx="20" cy="6" r="2"/><path d="M4 16V8"/><circle cx="4" cy="6" r="1.5"/></svg>`,

  undo: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/></svg>`,

  like: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 52 52" xml:space="preserve"><g stroke-width="0"/><g stroke-linecap="round" stroke-linejoin="round"/><path d="M10.5 21h-5c-.8 0-1.5.7-1.5 1.5v23c0 .8.7 1.5 1.5 1.5H8c2.2 0 4-1.8 4-4V22.5c0-.8-.7-1.5-1.5-1.5M44 22h-6c-2.2 0-4-1.8-4-4V8c0-2.2-1.8-4-4-4h-2.5c-.8 0-1.5.7-1.5 1.5v6c0 5.3-3.7 10.5-8.5 10.5-.8 0-1.5.7-1.5 1.5v20c0 .8.6 1.5 1.4 1.5 6.8.3 9.1 3 16.2 3 7.5 0 14.4-.8 14.4-9.5V26c0-2.2-1.8-4-4-4"/></svg>`,

  dislike: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 52 52" xml:space="preserve"><g stroke-width="0"/><g stroke-linecap="round" stroke-linejoin="round"/><path d="M12 29.5V9c0-2.2-1.8-4-4-4H5.5C4.7 5 4 5.7 4 6.5v23c0 .8.7 1.5 1.5 1.5h5c.8 0 1.5-.7 1.5-1.5M48 26V13.5C48 4.8 41.1 4 33.6 4c-7.1 0-9.4 2.7-16.2 3-.8 0-1.4.7-1.4 1.5v20c0 .8.7 1.5 1.5 1.5 4.8 0 8.5 5.2 8.5 10.5v6c0 .8.7 1.5 1.5 1.5H30c2.2 0 4-1.8 4-4V34c0-2.2 1.8-4 4-4h6c2.2 0 4-1.8 4-4"/></svg>`,

  clear: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>`
};
