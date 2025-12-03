import axios from "axios";

function assertCredentials() {
  if (!process.env.DATAFORSEO_LOGIN || !process.env.DATAFORSEO_PASSWORD) {
    throw new Error("DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD must be set");
  }
}

export function getDataForSeoClient() {
  assertCredentials();
  return axios.create({
    baseURL: "https://api.dataforseo.com",
    auth: {
      username: process.env.DATAFORSEO_LOGIN as string,
      password: process.env.DATAFORSEO_PASSWORD as string,
    },
    headers: {
      "content-type": "application/json",
    },
  });
}
