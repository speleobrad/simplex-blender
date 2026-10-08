function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function formatDiagnosticPressureBar(pressureBar) {
  return pressureBar >= 1 ? pressureBar.toFixed(1) : Number(pressureBar.toPrecision(2)).toString();
}

function renderDiagnosticDetails(diagnostics) {
  if (!diagnostics) return '';
  const explainedBanks = new Set();
  const details = diagnostics.componentShortfalls.map(shortfall => {
    const bank = shortfall.sourceBank;
    if (!bank) return `No enabled source bank can add ${shortfall.component.toLowerCase()}.`;
    explainedBanks.add(bank.id);
    if (bank.pressureEstimateOutOfRange) {
      return `${shortfall.component} shortfall: the pressure needed in ${bank.name} (${bank.volumeL} L) is outside the supported real-gas density range. It is currently at ${formatDiagnosticPressureBar(bank.currentPressureBar)} bar (${formatDiagnosticPressureBar(bank.minimumSourcePressureBar)} bar booster minimum).`;
    }
    return `${shortfall.component} shortfall: ${bank.name} (${bank.volumeL} L) would need to be at ${formatDiagnosticPressureBar(bank.requiredPressureBar)} bar to supply the missing gas. It is currently at ${formatDiagnosticPressureBar(bank.currentPressureBar)} bar (${formatDiagnosticPressureBar(bank.minimumSourcePressureBar)} bar booster minimum), a ${formatDiagnosticPressureBar(bank.pressureIncreaseBar)} bar increase.`;
  });
  for (const bank of diagnostics.exhaustedBanks) {
    if (explainedBanks.has(bank.id)) continue;
    details.push(
      `${bank.name} is fully drawn from ${formatDiagnosticPressureBar(bank.currentPressureBar)} bar to the ${formatDiagnosticPressureBar(bank.minimumSourcePressureBar)} bar booster minimum.`
    );
  }
  return details.join(' ');
}


function renderInfeasible(error, maximumPressure, requestedPressureBar, oxygenPercent, heliumPercent, diagnostics) {
  const message = document.createElement('div');
  message.className = 'p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs';
  message.setAttribute('role', 'alert');

  const heading = document.createElement('div');
  heading.className = 'font-bold flex items-center gap-2 mb-1';
  heading.textContent = maximumPressure ? 'Requested Pressure Is Unavailable' : 'No Feasible Solution Found';
  message.append(heading);

  const description = document.createElement('p');
  const diagnosticDetails = renderDiagnosticDetails(diagnostics);
  const safetyReason = error?.includes('4:1')
    ? ` ${error.split(' Maximum safe pressure')[0]}`
    : '';
  const requestedPressureReason = safetyReason
    ? `The exact target mix cannot safely reach ${requestedPressureBar.toFixed(1)} bar.`
    : `The exact target mix (${oxygenPercent}/${heliumPercent}) cannot reach ${requestedPressureBar.toFixed(1)} bar with the current gas supply.`;
  description.textContent = maximumPressure
    ? `${requestedPressureReason} ${diagnosticDetails} The maximum safely achievable pressure is ${maximumPressure.pressureBar.toFixed(1)} bar.${safetyReason} The recipe below makes that exact mix.`
    : [error || 'The available gas banks cannot satisfy both the target pressure and exact gas fractions.', diagnosticDetails].filter(Boolean).join(' ');
  message.append(description);
  return message;
}

function renderProtocol(protocolSteps, alertMessage = null) {
  const container = document.getElementById('steps-container');
  if (!container) return;

  const cards = protocolSteps.map(step => {
    const card = document.createElement('div');
    card.className = 'p-3 bg-ocean-950/70 border border-ocean-800 rounded-xl flex items-start justify-between gap-3';

    const details = document.createElement('div');
    details.className = 'flex-1';

    const heading = document.createElement('div');
    heading.className = 'flex items-center gap-2 mb-1';
    const title = document.createElement('span');
    title.className = 'text-sm font-bold text-slate-200';
    title.textContent = step.title;
    heading.append(title);

    const description = document.createElement('p');
    description.className = 'text-[11px] text-slate-400';
    description.textContent = step.description;
    details.append(heading, description);

    const result = document.createElement('div');
    result.className = 'text-right font-mono shrink-0';
    const label = document.createElement('div');
    label.className = 'text-[10px] text-slate-500 uppercase';
    label.textContent = 'Result';
    const pressure = document.createElement('div');
    pressure.className = 'text-sm font-bold text-cyan-300';
    pressure.textContent = `${step.resultingPressureBar.toFixed(1)} bar`;

    result.append(label, pressure);
    card.append(details, result);
    return card;
  });
  container.replaceChildren(...(alertMessage ? [alertMessage, ...cards] : cards));
}

function renderBlendSummary(blend) {
  setText('res-retained-p', `${blend.retainedPressureBar.toFixed(1)} bar`);
  setText('res-retained-pct', `${blend.retainedPercent.toFixed(0)}% kept`);
  setText('res-vented-p', `${blend.ventedPressureBar.toFixed(1)} bar`);
  setText('res-vented-litres', `${blend.ventedGasLitres.toFixed(1)} L lost`);
  setText('res-he-salvaged', `${Math.round(blend.heliumSalvagedLitres)} L`);
  setText('res-final-p', `${blend.finalPressureBar.toFixed(1)} bar`);
  setText('res-final-mix', `Tx ${blend.finalOxygenPercent}/${blend.finalHeliumPercent}`);
}

export function renderResults(result) {
  if (result.gas) {
    setText('lbl-init-p', result.gas.initialPressureBar);
    setText('lbl-target-p', result.gas.targetPressureBar);
  } else {
    for (const id of ['lbl-init-p', 'lbl-target-p']) {
      setText(id, '—');
    }
  }
  if (!result.feasible) {
    const maximum = result.maximumPressure;
    if (maximum) {
      renderBlendSummary(maximum.blend);
      renderProtocol(
        maximum.protocolSteps,
        renderInfeasible(
          result.error,
          maximum,
          result.gas.targetPressureBar,
          maximum.blend.finalOxygenPercent,
          maximum.blend.finalHeliumPercent,
          result.diagnostics
        )
      );
    } else {
      for (const id of [
        'res-retained-p',
        'res-retained-pct',
        'res-vented-p',
        'res-vented-litres',
        'res-he-salvaged',
        'res-final-p',
        'res-final-mix'
      ]) {
        setText(id, '—');
      }
      renderProtocol([], renderInfeasible(result.error, null, 0, 0, 0, result.diagnostics));
    }
    return;
  }

  renderBlendSummary(result.blend);
  renderProtocol(result.protocolSteps);
}
