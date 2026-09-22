/* Additive client-side validation for operational forms. Server validation remains authoritative. */
(()=>{
  const locale=()=>window.ST_I18N?.getLocale?.()||'en';
  const tr=(key,fallback)=>window.ST_I18N?.t?.(key,fallback)||fallback;
  const message=(text)=>window.toast?.(text,'error');
  const parseDate=(value)=>{const d=new Date(`${value}T12:00:00`);return Number.isNaN(d.getTime())?null:d};
  const validateRecurringForm=(form)=>{
    if(!form)return false;
    const weekdays=[...form.querySelectorAll('[name="weekdays"]:checked')];
    if(!weekdays.length){message(tr('Select at least one weekday','Select at least one weekday'));return false}
    const start=form.elements.startDate?.value||'';
    const end=form.elements.endDate?.value||'';
    if(end&&start&&parseDate(end)<parseDate(start)){message(tr('End date cannot be before start date','End date cannot be before start date'));return false}
    return true;
  };
  const validateGenerateForm=(form)=>{
    const until=form?.elements.until?.value||'';const target=parseDate(until);if(!target)return false;
    const now=new Date();now.setHours(12,0,0,0);const max=new Date(now);max.setDate(max.getDate()+90);
    if(target>max){message(tr('Generation is limited to 90 days','Generation is limited to 90 days'));return false}
    if(target<now){message(tr('Generate date cannot be in the past','Generate date cannot be in the past'));return false}
    return true;
  };
  window.ShineTimeValidation={validateRecurringForm,validateGenerateForm,locale};
  document.addEventListener('submit',event=>{
    const form=event.target;if(form?.id==='recurring-form'&&!validateRecurringForm(form))event.preventDefault();
    if(form?.id==='generate-form'&&!validateGenerateForm(form))event.preventDefault();
  });
  void locale;
})();
