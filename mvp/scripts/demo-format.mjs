import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeOfficialFormPreview } from '../src/pdf.mjs';
import { getFormat } from '../src/formats.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const output = path.resolve(here, '../output/pdf/formulario-pj-simulacion.pdf');
const data = {
  procedure: 'ALIMENTOS_NNA', isFictional: true, courtDistrict: 'Lima',
  applicantName: 'Ana Ejemplo', applicantDocument: 'DEMO12345', applicantAddress: 'Calle Ficticia 100',
  applicantDepartment: 'Lima', applicantProvince: 'Lima', applicantDistrict: 'Cercado de Lima',
  applicantPhone: '999000111', applicantEmail: 'ana@example.test', applicantElectronicMailbox: '000000',
  respondentName: 'Bruno Ejemplo', respondentDocument: 'DEMO67890', respondentAddress: 'Av. Simulada 250',
  respondentDepartment: 'Lima', respondentProvince: 'Lima', respondentDistrict: 'San Miguel',
  children: [{ name: 'Carla Ejemplo', birthDate: '2018-03-10', relationToRespondent: 'Hija' }],
  requestedAmount: 850, factDescription: 'La persona demandada no aporta a los gastos declarados.',
  expenseDescription: 'Alimentos y utiles escolares: S/ 850 al mes.',
  respondentEmployer: 'Empresa ficticia', respondentOccupation: 'Tecnico', respondentIncome: '2500'
};
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, await makeOfficialFormPreview(data, [{ original_name: 'Recibo ficticio.pdf' }], getFormat('pj-ra-2024')));
process.stdout.write(`${output}\n`);
