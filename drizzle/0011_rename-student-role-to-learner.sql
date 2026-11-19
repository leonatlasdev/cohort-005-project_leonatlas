-- The Student role is now called Learner (see GLOSSARY.md).
UPDATE `users` SET `role` = 'learner' WHERE `role` = 'student';
