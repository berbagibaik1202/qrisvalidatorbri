// Simulators are available only inside the isolated automated test environment.
export const simulationEnabled=()=>process.env.NODE_ENV==='test'&&process.env.MOCK_PROVIDER_ENABLED==='true';
