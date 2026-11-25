'use strict';

const DAY = 86_400_000;
const DAILY_RATE = 25_000;
const LODGING_LIMITS = { seoul: 100_000, metro: 80_000, other: 70_000 };
const TRANSPORT_LABELS = {
  rail: '철도', ship: '선박', air: '항공', bus: '버스 등',
  car: '자가용', official: '공용 교통수단',
};
const money = (amount) => `${amount.toLocaleString('ko-KR')}원`;

function calculateTrip(trip) {
  const start = Date.parse(trip.departure);
  const end = Date.parse(trip.return);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    throw new Error('복귀일은 출발일과 같거나 이후여야 합니다.');
  }
  const days = (end - start) / DAY + 1;
  const row = (label, amount, basis) => ({ label, amount, basis });

  if (trip.tripType === 'within') {
    const startTime = Date.parse(`${trip.departure}T${trip.startTime}:00Z`);
    const endTime = Date.parse(`${trip.return}T${trip.endTime}:00Z`);
    const minutes = (endTime - startTime) / 60_000;
    if (!Number.isFinite(minutes) || minutes <= 0) {
      throw new Error('복귀 시각은 출발 시각보다 늦어야 합니다.');
    }
    const base = minutes >= 240 ? 20_000 : 10_000;
    const reduction = { none: 0, official: 10_000, assigned: base }[trip.withinVehicle];
    const reason = trip.withinVehicle === 'assigned' ? '전용 차량 배정으로 지급 제외' : '공무용 차량 이용 등';
    return {
      duration: `출장 시간 ${Math.floor(minutes / 60)}시간 ${minutes % 60}분`,
      rows: [
        row('근무지 내 출장여비', base, minutes >= 240 ? '4시간 이상' : '4시간 미만'),
        ...(reduction ? [row('차량에 따른 감액', -reduction, reason)] : []),
      ],
      note: days > 1 ? '입력한 전체 시간을 한 건의 연속 출장으로 계산했습니다.' : '',
    };
  }

  const nights = trip.lodging.reduce((sum, entry) => sum + entry.nights, 0);
  if (nights >= days) throw new Error('숙박일수 합계가 출발일부터 복귀일까지의 숙박 가능 일수를 초과했습니다.');
  if (trip.halfDays > days || trip.noMealDays > days) {
    throw new Error('일비 반액 적용 일수와 식비 제외 일수는 각각 전체 출장일수를 초과할 수 없습니다.');
  }

  const actual = trip.grade === 'actual';
  const daily = actual ? trip.actualDaily : DAILY_RATE * days - DAILY_RATE / 2 * trip.halfDays;
  if (trip.stayDeduction > daily) throw new Error('장기 체재 감액액이 일비를 초과했습니다.');
  const mealDays = days - trip.noMealDays;
  const meals = actual ? trip.actualMeals : DAILY_RATE * mealDays;
  if (actual && mealDays === 0 && meals > 0) {
    throw new Error('출장 전체가 식비 미지급 대상이면 식비 실비에 0원을 입력하세요.');
  }
  const mileageCeiling = actual ? trip.mileageDaily : DAILY_RATE / 2 * days;
  const mileage = Math.min(trip.mileageSavings, trip.mileageDaily, mileageCeiling);
  if (trip.mileageDaily && !trip.mileageSavings) throw new Error('공적 마일리지로 절약한 운임을 입력하세요.');
  const fareRows = trip.transport.map(({ mode, fare, unavoidable }) => {
    const basis = {
      rail: trip.grade === '2' ? '일반실 기준' : '특실 기준',
      ship: trip.grade === '2' ? '2등급 기준' : '1등급 기준',
      air: '지급 등급에 해당하는 항공운임',
      bus: '정산 대상 운임',
      car: unavoidable ? '정산 대상 연료비·통행료 등' : '해당 철도 또는 버스 기준 운임',
      official: '공용 교통수단 이용분은 운임 미지급',
    };
    return row(TRANSPORT_LABELS[mode], mode === 'official' ? 0 : fare, basis[mode]);
  });
  const lodging = trip.lodging.reduce((totals, { region, nights, rate }) => {
    const limit = trip.grade === '2' ? LODGING_LIMITS[region] : rate;
    totals.base += Math.min(rate, limit) * nights;
    if (trip.extendedLodging) {
      totals.extra += Math.min(Math.max(rate - limit, 0), limit * 0.3) * nights;
    }
    return totals;
  }, { base: 0, extra: 0 });
  return {
    duration: `출장 ${days}일 · 숙박 ${nights}박`,
    rows: [
      row('일비', daily, actual ? '입력한 실비' : `${days - trip.halfDays}일 × 25,000원${trip.halfDays ? ` + ${trip.halfDays}일 × 12,500원` : ''}`),
      ...(trip.stayDeduction ? [row('장기 체재 감액', -trip.stayDeduction, '입력한 감액액')] : []),
      ...(mileage ? [row('마일리지 추가 일비', mileage, '입력한 지급 가능액, 절약 운임 및 추가 일비 한도 반영')] : []),
      row('식비', meals, actual ? '지급 대상에 해당하는 실비' : `${mealDays}일 × 25,000원`),
      row('운임', fareRows.reduce((sum, item) => sum + item.amount, 0),
        fareRows.map((item) => `${item.label} ${money(item.amount)} (${item.basis})`).join(' · ') || '입력 내역 없음'),
      row('숙박비', lodging.base, `${nights}박${trip.grade === '2' && nights ? ' · 지역별 상한 적용' : ' · 실비'}`),
      ...(lodging.extra ? [row('숙박비 추가 정산', lodging.extra, '지역별 상한의 30% 이내')] : []),
    ],
    note: lodging.extra ? '숙박비 초과분은 지급 요건과 증빙을 확인한 뒤 별도 정산합니다.' : '',
  };
}

function initializeCalculator() {
  const form = document.querySelector('#trip-form');
  const field = (name) => form.elements.namedItem(name);
  const get = (name) => field(name).value;
  const total = document.querySelector('#total');
  const duration = document.querySelector('#duration');
  const items = document.querySelector('#items');
  const note = document.querySelector('#result-note');
  const error = document.querySelector('#form-error');
  const printButton = document.querySelector('#print-result');
  const printTrip = document.querySelector('#print-trip');
  const printPeriod = document.querySelector('#print-period');
  const excelButton = document.querySelector('#save-excel');
  const excelError = document.querySelector('#excel-error');
  let exportResult = null;
  printButton.addEventListener('click', () => window.print());
  excelButton.addEventListener('click', async () => {
    const snapshot = exportResult;
    if (!snapshot) return;
    excelError.hidden = true;
    try {
      await saveTravelWorkbook(snapshot);
    } catch {
      if (exportResult !== snapshot) return;
      excelError.textContent = '엑셀 파일을 저장하지 못했습니다. 앱 파일이 같은 폴더에 있는지 확인한 뒤 다시 시도하세요.';
      excelError.hidden = false;
    }
  });
  const group = (id, visible) => {
    const section = document.querySelector(id);
    section.hidden = !visible;
    section.disabled = !visible;
  };
  const makeItem = ({ label, amount, basis }) => {
    const item = document.createElement('div');
    const term = document.createElement('dt');
    const value = document.createElement('dd');
    term.textContent = label;
    value.textContent = amount === null ? '—' : money(amount);
    item.append(term, value);
    if (basis) {
      const detail = document.createElement('small');
      detail.textContent = basis;
      term.append(detail);
    }
    return item;
  };
  const clearResult = () => {
    total.textContent = '—';
    duration.textContent = '출장 정보를 입력하고 여비를 계산하세요.';
    items.replaceChildren(makeItem({ label: '출장여비', amount: null }));
    note.hidden = true;
    error.hidden = true;
    printButton.disabled = true;
    excelButton.disabled = true;
    excelError.hidden = true;
    exportResult = null;
    printTrip.textContent = '';
    printPeriod.textContent = '';
  };
  const updateFields = () => {
    const within = get('tripType') === 'within';
    group('#within-fields', within);
    group('#outside-fields', !within);
    group('#actual-fields', !within && get('grade') === 'actual');
    field('halfDays').disabled = get('grade') === 'actual';
    field('return').min = get('departure');
  };
  const find = (entry, key) => entry.querySelector(`[data-field="${key}"]`);
  const updateTransport = (entry) => {
    const mode = find(entry, 'mode').value;
    const unavoidable = find(entry, 'unavoidable');
    unavoidable.disabled = mode !== 'car';
    entry.querySelector('[data-label="unavoidable"]').hidden = unavoidable.disabled;
    const fare = find(entry, 'fare');
    fare.disabled = mode === 'official';
    const label = entry.querySelector('[data-label="fare"]');
    label.hidden = fare.disabled;
    label.querySelector('span').textContent = mode !== 'car' ? '정산 대상 운임 (원)' :
      unavoidable.checked ? '정산 대상 연료비·통행료 등 (원)' : '철도 또는 버스 기준 운임 (원)';
    entry.querySelector('[data-label="transport-hint"]').textContent = mode === 'official'
      ? '공용 차량·선박·항공기 이용분의 운임은 0원입니다. 일비 반액 대상 일수는 위에 입력하세요.'
      : '';
  };
  for (const type of ['transport', 'lodging']) {
    const add = document.querySelector(`#add-${type}`);
    add.addEventListener('click', () => {
      const template = document.querySelector(`#${type}-template`);
      const entry = template.content.firstElementChild.cloneNode(true);
      const rows = document.querySelector(`#${type}-rows`);
      rows.append(entry);
      if (type === 'transport') {
        updateTransport(entry);
        entry.addEventListener('change', () => updateTransport(entry));
      }
      entry.querySelector('.remove').addEventListener('click', () => {
        entry.remove();
        add.focus();
        clearResult();
      });
      entry.querySelector('select').focus();
      clearResult();
    });
  }

  form.addEventListener('input', () => {
    updateFields();
    clearResult();
  });
  form.addEventListener('invalid', (event) => {
    const details = event.target.closest('details');
    if (details) details.open = true;
  }, true);
  form.addEventListener('reset', () => {
    document.querySelector('#transport-rows').replaceChildren();
    document.querySelector('#lodging-rows').replaceChildren();
    form.querySelector('details').open = false;
    clearResult();
    setTimeout(updateFields);
  });
  const number = (input) => {
    const value = Number(input.value);
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('금액과 일수는 0 이상의 정수로 입력하세요.');
    return value;
  };
  const readRows = (type, read) => Array.from(document.querySelectorAll(`#${type}-rows .entry`), read);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    clearResult();
    try {
      const trip = {
        tripType: get('tripType'), departure: get('departure'), return: get('return'),
        startTime: get('startTime'), endTime: get('endTime'), withinVehicle: get('withinVehicle'),
      };
      if (trip.tripType === 'outside') {
        const grade = get('grade');
        Object.assign(trip, {
          grade,
          actualDaily: grade === 'actual' ? number(field('actualDaily')) : 0,
          actualMeals: grade === 'actual' ? number(field('actualMeals')) : 0,
          halfDays: grade === 'actual' ? 0 : number(field('halfDays')),
          noMealDays: number(field('noMealDays')),
          mileageSavings: number(field('mileageSavings')),
          mileageDaily: number(field('mileageDaily')),
          stayDeduction: number(field('stayDeduction')),
          extendedLodging: field('extendedLodging').checked,
          transport: readRows('transport', (entry) => {
            const mode = find(entry, 'mode').value;
            return {
              mode, fare: mode === 'official' ? 0 : number(find(entry, 'fare')),
              unavoidable: find(entry, 'unavoidable').checked,
            };
          }),
          lodging: readRows('lodging', (entry) => ({
            region: find(entry, 'region').value, nights: number(find(entry, 'nights')),
            rate: number(find(entry, 'rate')),
          })),
        });
      }
      const result = calculateTrip(trip);
      const amount = result.rows.reduce((sum, item) => sum + item.amount, 0);
      if (!Number.isSafeInteger(amount)) throw new Error('계산 가능한 금액 범위를 초과했습니다.');
      duration.textContent = result.duration;
      items.replaceChildren(...result.rows.map(makeItem));
      note.textContent = result.note;
      note.hidden = !result.note;
      total.textContent = money(amount);
      const within = trip.tripType === 'within';
      const gradeLabel = { '1': '제1호', '2': '제2호', actual: '대통령·국무총리' };
      const tripLabel = within ? '근무지 내 출장' : `근무지 외 출장 · ${gradeLabel[trip.grade]}`;
      const departure = within ? `${trip.departure} ${trip.startTime}` : trip.departure;
      const returnDate = within ? `${trip.return} ${trip.endTime}` : trip.return;
      const period = `${departure} ~ ${returnDate}`;
      printTrip.textContent = tripLabel;
      printPeriod.textContent = period;
      printButton.disabled = false;
      exportResult = { ...result, amount, tripLabel, period, date: trip.departure };
      excelButton.disabled = false;
      if (window.matchMedia('(max-width: 760px)').matches) {
        document.querySelector('#result').focus();
      }
    } catch (issue) {
      error.textContent = issue.message;
      error.hidden = false;
    }
  });
  updateFields();
}

if (typeof document !== 'undefined') initializeCalculator();
