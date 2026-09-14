const axios = require("axios");
const API = "http://localhost:3001/api/v1";

async function main() {
  const loginRes = await axios.post(`${API}/auth/login`, {
    email: "hrpayroll@sece.ac.in",
    password: "EOS@test123",
  });
  const { accessToken } = loginRes.data.data;
  const auth = { headers: { Authorization: `Bearer ${accessToken}` } };
  console.log("logged in as HR Payroll");

  const res = await axios.get(`${API}/me/library/staff-borrow-records`, auth);
  console.log("status:", res.status);
  console.log("raw response:", JSON.stringify(res.data, null, 2));
}
main().catch((err) => {
  console.error("FAILED:", err.response?.status, JSON.stringify(err.response?.data ?? err.message));
  process.exit(1);
});
