/**
 * @file sunoClient.ts
 * @description Suno API client implementation for generating and retrieving songs.
 */

import axios, { AxiosResponse } from "axios";
import { calculateDuration } from "../utils/utils";

import {
  GenerateSongResponse,
  StatusResponse,
  SongResponse,
  SongOptions,
} from "../interfaces/apiResponses";
import { Logger } from "../utils/logger";
import { MAX_DURATION } from "../config/env";

/**
 * @class SunoClient
 * @classdesc A client for interacting with the Suno API to generate and fetch music.
 */
export class SunoClient {
  private readonly apiKey: string;
  private readonly baseUrl: string = "https://api.ttapi.org/suno/v1";

  /**
   * @constructor
   * @param {string} apiKey - Suno API authentication key
   */
  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error("API key is required");
    }
    this.apiKey = apiKey;
  }

  /**
   * @async
   * @function generateSong
   * @description Submits a new song generation request to the Suno API
   * @param {string} prompt - The prompt or idea for the music
   * @param {SongOptions} [options] - Additional configuration options
   * @returns {Promise<string>} - Returns the job ID assigned to the generation request
   * @throws {Error} - Throws an error if the API call fails
   */
  async generateSong(prompt: string, options?: SongOptions): Promise<string> {
    try {
      const payload = {
        mv: options?.mv || "chirp-v4", // Default to chirp-v4
        custom: true, // Determine if it's a custom prompt
        instrumental: false, // Required field
        gpt_description_prompt: prompt,
        prompt: options?.lyrics,
        title: options?.title || "Generated Song",
        tags: options?.tags?.join(",") || "pop", // Suno expects string for tags
      };

      Logger.info("Starting song generation...");
      const response: AxiosResponse<GenerateSongResponse> = await axios.post(
        `${this.baseUrl}/music`, // Correct endpoint
        payload,
        this.getRequestHeaders()
      );

      if (response.status !== 200) {
        throw new Error("Invalid API response");
      }

      const data = response.data.data;

      if (!data.jobId) {
        throw new Error("Invalid API response (missing jobId)");
      }

      Logger.success(`Job started - ID: ${data.jobId}`);
      return data.jobId;
    } catch (error) {
      const errorMessage = `Generation failed: ${
        (error as Error).message
      } | Response: ${JSON.stringify((error as any).response?.data)}`;
      Logger.error(errorMessage);
      throw new Error(errorMessage);
    }
  }

  /**
   * @async
   * @function checkStatus
   * @description Checks the status of a given job ID
   * @param {string} jobId - The job ID to query
   * @returns {Promise<StatusResponse>} - The status response from the API
   * @throws {Error} - Throws an error if the API call fails
   */
  async checkStatus(jobId: string): Promise<StatusResponse> {
    try {
      const response: AxiosResponse<StatusResponse> = await axios.post(
        `${this.baseUrl}/fetch`,
        { jobId },
        this.getRequestHeaders()
      );

      return {
        status: response.data.status,
        progress: parseInt(response.data.data?.progress || "0"),
        data: response.data.data,
      };
    } catch (error) {
      const errorMessage = `Status check failed: ${
        (error as Error).message
      } | Response: ${JSON.stringify((error as any).response?.data)}`;
      Logger.error(errorMessage);
      throw new Error(errorMessage);
    }
  }

  /**
   * @async
   * @function getSong
   * @description Retrieves the completed song data once the job has succeeded
   * @param {string} jobId - The job ID to retrieve
   * @returns {Promise<SongResponse>} - The structured song data
   * @throws {Error} - Throws an error if the song is not ready or retrieval fails
   */
  async getSong(jobId: string): Promise<SongResponse> {
    try {
      const status = await this.checkStatus(jobId);

      if (status.status !== "SUCCESS") {
        throw new Error(`Song not ready. Current status: ${status.status}`);
      }

      let duration = await calculateDuration(status.data.musics[0].audioUrl);
      if (MAX_DURATION && duration > MAX_DURATION) {
        duration = MAX_DURATION;
      }

      return {
        jobId: status.data.jobId,
        music: {
          musicId: status.data.musics[0].musicId,
          title: status.data.musics[0].title,
          audioUrl: status.data.musics[0].audioUrl,
          duration,
        },
      };
    } catch (error) {
      const errorMessage = `Retrieval failed: ${(error as Error).message}`;
      Logger.error(errorMessage);
      throw new Error(errorMessage);
    }
  }

  /**
   * @async
   * @function waitForCompletion
   * @description Polls the job status until completion or failure
   * @param {string} jobId - The job ID to poll
   * @param {number} [interval=5000] - Polling interval in milliseconds
   * @returns {Promise<void>} - Resolves once job is complete, rejects on failure
   */
  async waitForCompletion(
    jobId: string,
    interval: number = 5000
  ): Promise<void> {
    return new Promise(async (resolve, reject) => {
      const poll = async () => {
        try {
          const status = await this.checkStatus(jobId);

          switch (status.status) {
            case "SUCCESS":
              Logger.success("Generation completed!");
              resolve();
              break;
            case "FAILED":
              Logger.error("Server error");
              reject(new Error(status.data?.message || "Unknown error"));
              break;
            case "ON_QUEUE":
              Logger.info(`Job ${status.data?.jobId}: Waiting in queue...`);
              setTimeout(poll, interval);
              break;
            default:
              Logger.info(`Status: ${JSON.stringify(status)}`);
              setTimeout(poll, interval);
          }
        } catch (error) {
          reject(error);
        }
      };

      await poll();
    });
  }

  /**
   * @private
   * @method getRequestHeaders
   * @description Returns the necessary headers for API requests
   * @returns {object} - Headers object
   */
  private getRequestHeaders() {
    return {
      headers: {
        "TT-API-KEY": this.apiKey,
        "Content-Type": "application/json",
      },
    };
  }
}
