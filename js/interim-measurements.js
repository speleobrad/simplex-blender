export function calculatorInputSignature(input) {
  const thermal = input?.thermal
    ? { ...input.thermal, interimMeasurements: undefined }
    : input?.thermal;
  return JSON.stringify({ ...input, thermal });
}

export function signatureAfterClearingMeasurement(input, index) {
  const measurements = input?.thermal?.interimMeasurements;
  if (!Array.isArray(measurements)) return null;
  const hasRemainingMeasurement = measurements.some(
    (measurement, measurementIndex) => measurementIndex !== index && Boolean(measurement)
  );
  return hasRemainingMeasurement ? calculatorInputSignature(input) : null;
}
