/**
 * Import function triggers from their respective submodules:
 *
 * import {onCall} from "firebase-functions/v2/https";
 * import {onDocumentWritten} from "firebase-functions/v2/firestore";
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import axios from 'axios';
import {onRequest} from "firebase-functions/v2/https";

// Start writing functions
// https://firebase.google.com/docs/functions/typescript

admin.initializeApp();

interface InterviewQuestion {
  difficulty: string;
  keywords: string[];
  question: string;
  topic: string;
  candidateAnswer: string | null;
  score: number;
  explanation: string;
}

interface InterviewDocModel {
  title: string;
  questionsCount: number;
  domain: string | null;
  topics: string;
  difficulty: string;
  jobDescription: string;
  resume: string;
  date: string;
  preciseTime: string;
  analysed: boolean;
  evaludationId: string | null;
  interviewQuestions: InterviewQuestion[] | null;
  type: string;
}

interface FunctionData {
  docId: string;
  interviewData: InterviewDocModel;
}


export const helloWorld = onRequest((request, response) => {
  response.send("Hello from Firebase!");
});

export const helloWorldMidhun = onRequest((request, response) => {
  response.send("Hello from Midhun!");
});


export const evaluateMockInterview = functions.https.onCall(async (data: FunctionData, context) => {
  // Check if the user is authenticated
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'The function must be called while authenticated.');
  }

  const userId = context.auth.uid;
  const { docId, interviewData } = data;
  
  try {
    // Start processing the interview for evaluation
    functions.logger.info('Starting evaluation process', { docId });
    
    // Update document to indicate processing has started
    await admin.firestore()
      .collection(`users/${userId}/archives`)
      .doc(docId)
      .update({ 
        'analysed': false,
        'evaluationInProgress': true 
      });
    
    // Process each interview question with DeepSeek API
    const evaluatedQuestions = await evaluateInterviewAnswers(interviewData);
    
    // Update the document with evaluation results
    await admin.firestore()
      .collection(`users/${userId}/archives`)
      .doc(docId)
      .update({
        'interviewQuestions': evaluatedQuestions,
        'analysed': true,
        'evaluationInProgress': false
      });
    
    // Send notification to the user that their evaluation is ready
    await sendEvaluationNotification(userId, docId);
    
    return { success: true, docId };
  } catch (error) {
    functions.logger.error('Error evaluating interview', error);
    throw new functions.https.HttpsError('internal', 'Error evaluating interview');
  }
});

async function evaluateInterviewAnswers(interviewData: InterviewDocModel): Promise<InterviewQuestion[]> {
  if (!interviewData.interviewQuestions || interviewData.interviewQuestions.length === 0) {
    throw new Error('No interview questions found');
  }
  
  const evaluatedQuestions: InterviewQuestion[] = [];
  
  for (const question of interviewData.interviewQuestions) {
    if (!question.candidateAnswer) {
      // Skip questions with no answers
      evaluatedQuestions.push({
        ...question,
        score: 0,
        explanation: 'No answer provided'
      });
      continue;
    }
    
    // Create the prompt for DeepSeek API
    const messages = [
      {
        role: 'system',
        content: `You are an expert technical interviewer for ${interviewData.domain || 'technology'} positions. 
                 Evaluate the candidate's answer to the interview question. 
                 Consider technical accuracy, clarity, completeness, and relevance.
                 Score from 0-5 and provide brief, specific feedback.
                 Format your response as JSON: {"score": number, "explanation": "string"}`
      },
      {
        role: 'user',
        content: `Question: ${question.question}\n\nCandidate's Answer: ${question.candidateAnswer}\n\nDifficulty: ${question.difficulty}\nTopics: ${question.topic}\nKeywords to look for: ${question.keywords.join(', ')}`
      }
    ];
    
    try {
      const response = await axios.post('https://api.deepseek.com/chat/completions', {
        messages,
        model: 'deepseek-chat',
        response_format: { type: 'json_object' }
      }, {
        headers: {
          'Authorization': `Bearer sk-c707e08e61fe4ba2ab4b9f51d1e79410`,
          'Content-Type': 'application/json'
        }
      });
      
      const aiResponse = response.data.choices[0].message.content;
      const evaluation = JSON.parse(aiResponse);
      
      evaluatedQuestions.push({
        ...question,
        score: evaluation.score,
        explanation: evaluation.explanation
      });
    } catch (error) {
      functions.logger.error('Error calling DeepSeek API', error);
      
      // If API fails, add a placeholder evaluation
      evaluatedQuestions.push({
        ...question,
        score: 0,
        explanation: 'Error evaluating answer. Please try again later.'
      });
    }
  }
  
  return evaluatedQuestions;
}

async function sendEvaluationNotification(userId: string, docId: string): Promise<void> {
  // Send to the topic specific to this document
  const message = {
    data: {
      type: 'interview_evaluation',
      title: 'Interview Evaluation Ready',
      message: 'Your mock interview has been evaluated! Tap to view results.',
      docId: docId
    },
    topic: `interview-evaluation-${docId}`
  };
  
  try {
    await admin.messaging().send(message);
    functions.logger.info('Notification sent successfully', { docId });
  } catch (error) {
    functions.logger.error('Error sending notification', error);
  }
} 