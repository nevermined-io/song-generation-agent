/**
 * @file songMetadataGenerator.ts
 * @description Generates complete song metadata using LangChain's RunnableSequence and structured JSON output.
 */

import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { RunnableSequence, RunnableLambda } from "@langchain/core/runnables";
import { JsonOutputParser } from "@langchain/core/output_parsers";
import { Logger } from "./utils/logger";
import { AIMessage } from "@langchain/core/messages";

import { HELICONE_API_KEY } from "./config/env";
import { generateDeterministicAgentId, generateSessionId, logSessionInfo } from "./utils/utils";

/**
 * Represents the complete song metadata structure
 * @interface
 * @property {string} title - Concise song title without extra punctuation
 * @property {string} lyrics - Complete lyrics including verses, chorus, and bridge
 * @property {string[]} tags - Genre/style descriptors (3-5 elements)
 */
export interface SongMetadata {
  title: string;
  lyrics: string;
  tags: string[];
}

/**
 * A custom Runnable to extract pure JSON from an LLM response (AIMessage), ignoring
 * any text before or after the JSON block. This handles `content` that might be string or array.
 */
export const extractJsonRunnable = new RunnableLambda<AIMessage, string>({
  /**
   * The main function receiving `AIMessage`. We'll turn `content` (which may be array or string)
   * into a single string, then run a regex to find the JSON block.
   */
  func: async (input: AIMessage): Promise<string> => {
    const contentString = extractStringFromMessageContent(input.content);
    const jsonMatch = contentString.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
    if (!jsonMatch) {
      throw new Error("No JSON found in the LLM response.");
    }
    return jsonMatch[0]; // The substring from the first '{' to the last '}'
  },
});

/**
 * Safely extract a string from an AIMessage content, which might be a string or an array.
 *
 * @param inputContent - The `AIMessage.content`, which can be string or array.
 * @returns A single string that merges array elements or returns the original string.
 */
function extractStringFromMessageContent(inputContent: string | any[]): string {
  if (typeof inputContent === "string") {
    return inputContent;
  }

  if (Array.isArray(inputContent)) {
    // Combine each array element into one single text block.
    // You can customize how you join them (spaces, line breaks, etc.).
    return inputContent
      .map((part) => {
        if (typeof part === "string") {
          return part;
        } else if (part && typeof part === "object") {
          // Example: convert objects to JSON strings or do something else
          return JSON.stringify(part);
        }
        return String(part);
      })
      .join("\n");
  }

  // Fallback if it's some other unexpected type
  return String(inputContent);
}

/**
 * Generates structured song metadata using a single LLM call pipeline
 * @class
 */
export class SongMetadataGenerator {
  private readonly agentId: string;
  private readonly sessionId: string;
  private chain: RunnableSequence<{ idea: string }, SongMetadata>;

  /**
   * Initializes the generator with LLM chain
   * @constructor
   * @param {string} apiKey - OpenAI API key for authentication
   * @throws {Error} If API key is missing
   */
  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error("OpenAI API key is required for SongMetadataGenerator.");
    }

    // Generate deterministic agent ID and random session ID
    this.agentId = generateDeterministicAgentId();
    this.sessionId = generateSessionId();
    
    // Log session information
    logSessionInfo(this.agentId, this.sessionId, 'SongMetadataGenerator');

    const llm = new ChatOpenAI({
      model: "gpt-4o-mini",
      apiKey,
      configuration: {
        baseURL: "https://oai.helicone.ai/v1",
        defaultHeaders: {
          "Helicone-Auth": `Bearer ${HELICONE_API_KEY}`,
          "Helicone-Property-AgentId": this.agentId,
          "Helicone-Property-SessionId": this.sessionId,
        }
      }
    });

    const promptTemplate = ChatPromptTemplate.fromTemplate(`

      You are a professional songwriter and music metadata expert. Your task is to generate a complete song's metadata in STRICTLY VALID JSON format using this structure:  

      {{
        "title": "Creative song title",
        "lyrics": "Full lyrics with verses and chorus",
        "tags": ["genre", "mood"]
      }}
      
      Guidelines:  
      1. Title: Maximum 60 characters, no special punctuation.  
      2. Lyrics: Must be complete, including at least 3 verses + chorus (bridge, intro, and outros are optional but encouraged).  
      3. Tags: Provide 3-5 descriptive keywords for genre, style, and mood. For example, ["folk", "pop", "acoustic", "melancholic"].
      4. Output strictly as JSON—NO extra text, explanations, or formatting outside the JSON block.  
      5. Never include double quotes (") in the lyrics text.
      
      Enhancements for Creativity & Musical Expression:  
      - Song structure clarity: Use brackets [ ] to define sections such as:  
        - [Intro] [Verse 1] [Chorus] [Bridge] [Outro]  
        - Advanced instructions: [Flute solo intro] [Crescendo] [Whispering vocals] [Screaming vocals]  
      - Emphasis through capitalization: Highlight intensity with ALL CAPS (e.g., "I CAN'T LET GO!")  
      - Sound effects using asterisks: Incorporate atmosphere with *whispering*, *gunshots*, *echo fades*, etc.  
      - Creative genre fusion: Describe unique styles, e.g., "haunting g-funk horror doom trap r&b".  
      - Workarounds for language filters: Replace sensitive words (e.g., "die" → "dye", "kill" → "ill").  
      
      Example Output:  
      {{
        "title": "Neon Heartbeat Symphony",
        "lyrics": "[Intro]\\n*Soft synths fading in*\\n[Verse 1]\\nCity lights are calling me home...\\n[Chorus]\\nNEON HEARTBEAT, DON'T LET ME GO!\\n[Verse 2]\\nEvery step echoes in the rain...\\n[Guitar solo]\\n[Outro]\\n*Distant echoes fading out*",
        "tags": ["synth-pop", "retro-futuristic", "dance"]
      }}
      
      Now, generate a song based on this concept: {idea}
    `);

    this.chain = RunnableSequence.from([
      promptTemplate,
      llm,
      extractJsonRunnable,
      new JsonOutputParser(),
    ]);
  }

  /**
   * Generates structured song metadata from user input
   * @async
   * @param {string} idea - User's song concept or theme
   * @returns {Promise<SongMetadata>} Structured metadata object
   * @throws {Error} If generation fails validation
   */
  async generateMetadata(idea: string): Promise<SongMetadata> {
    try {
      const metadata = await this.chain.invoke({ idea });

      // Validate response structure
      if (!metadata?.title || !metadata?.lyrics || !metadata?.tags) {
        throw new Error("Invalid response structure from LLM");
      }

      // Validate tags array format
      if (
        !Array.isArray(metadata.tags) ||
        metadata.tags.some((t) => typeof t !== "string")
      ) {
        throw new Error("Invalid tag format in response");
      }

      // Validate lyrics length
      if (metadata.lyrics.split("\n").length < 5) {
        throw new Error("Insufficient lyrics content");
      }

      Logger.success("Metadata generation successful");
      return metadata as SongMetadata;
    } catch (error) {
      Logger.error(`Metadata generation failed: ${error}`);
      throw new Error(`Generation error: ${(error as Error).message}`);
    }
  }
}
